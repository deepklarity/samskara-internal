import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { lstat, readFile, readlink } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { z } from "zod"

export const MAX_CODE_STATE_FILE_BYTES = 1024 * 1024
export const MAX_CODE_STATE_TOTAL_BYTES = 20 * 1024 * 1024
export const MAX_CODE_STATE_PATHS = 1000
const MAX_GIT_OUTPUT_BYTES = 24 * 1024 * 1024
const CAPTURE_TIMEOUT_MS = 10_000

const layerSchema = z.enum(["index", "worktree", "untracked"])
const fileSchema = z
  .object({
    path: z.string().min(1),
    layer: layerSchema,
    kind: z.enum(["file", "deletion"]),
    contentBase64: z.string().optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    mode: z
      .string()
      .regex(/^[0-7]{6}$/)
      .optional(),
    previousPath: z.string().min(1).optional(),
  })
  .strict()
const omissionSchema = z
  .object({
    path: z.string().min(1).optional(),
    layer: layerSchema.optional(),
    reason: z.string().min(1),
  })
  .strict()

export const codeStateSnapshotSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string().min(1),
    phase: z.enum(["start", "end", "review"]),
    captureId: z.uuid(),
    capturedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    cwd: z.string().refine(isAbsolute),
    repoRoot: z.string().refine(isAbsolute),
    headSha: z.string().regex(/^[a-f0-9]{40,64}$/),
    complete: z.boolean(),
    files: z.array(fileSchema),
    omissions: z.array(omissionSchema),
  })
  .strict()

export type CodeStateSnapshot = z.infer<typeof codeStateSnapshotSchema>
type CodeStateFile = CodeStateSnapshot["files"][number]
type CodeStateOmission = CodeStateSnapshot["omissions"][number]
type Layer = CodeStateFile["layer"]

const git = (cwd: string, args: ReadonlyArray<string>, timeout = 15_000): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      { cwd, encoding: "buffer", maxBuffer: MAX_GIT_OUTPUT_BYTES, timeout },
      (error, stdout) => {
        if (error) reject(error)
        else resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout))
      },
    )
  })

const nullFields = (output: Buffer): string[] =>
  output
    .toString("utf8")
    .split("\0")
    .filter((field) => field.length > 0)

const safeRelative = (repoRoot: string, path: string): boolean => {
  if (isAbsolute(path)) return false
  const resolved = resolve(repoRoot, path)
  const rel = relative(repoRoot, resolved)
  return (
    rel !== "" && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  )
}

const excluded = (path: string): string | null => {
  const parts = path.toLowerCase().split("/")
  const name = parts.at(-1) ?? ""
  if (
    parts.some((part) =>
      ["node_modules", "dist", "build", "coverage", ".next", "vendor", "generated"].includes(part),
    )
  )
    return "generated-or-dependency"
  if (
    name.startsWith(".env") ||
    /(secret|password|credential|private-key)/i.test(name) ||
    /\.(pem|p12|pfx|key)$/i.test(name)
  )
    return "sensitive-file"
  return null
}

type IndexEntry = { readonly mode: string; readonly oid: string }

const indexEntries = (output: Buffer, omissions: CodeStateOmission[]): Map<string, IndexEntry> => {
  const result = new Map<string, IndexEntry>()
  for (const field of nullFields(output)) {
    const tab = field.indexOf("\t")
    const path = field.slice(tab + 1)
    const match = /^(\d{6}) ([a-f0-9]{40,64}) ([0-3])$/.exec(field.slice(0, tab))
    if (!match || tab < 0 || !match[1] || !match[2]) {
      omissions.push({ reason: "unparsed-index-entry" })
      continue
    }
    if (match[3] !== "0") {
      omissions.push({ path, layer: "index", reason: "unmerged-index-entry" })
      continue
    }
    result.set(path, { mode: match[1], oid: match[2] })
  }
  return result
}

/** Rename hints are provenance only. The delta still contains separate deletion and file entries. */
const renameHints = (output: Buffer): Map<string, string> => {
  const fields = nullFields(output)
  const result = new Map<string, string>()
  for (let index = 0; index < fields.length; index++) {
    const status = fields[index]
    if (!status) continue
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = fields[++index]
      const to = fields[++index]
      if (from && to) result.set(to, from)
    } else {
      index++
    }
  }
  return result
}

const contentFile = async (
  repoRoot: string,
  path: string,
): Promise<{ readonly bytes: Buffer; readonly mode: string } | null> => {
  const absolute = join(repoRoot, path)
  const info = await lstat(absolute).catch(() => null)
  if (!info) return null
  if (info.isSymbolicLink()) {
    const target = await readlink(absolute)
    return { bytes: Buffer.from(target), mode: "120000" }
  }
  if (!info.isFile()) throw new Error("unsupported-file-type")
  if (info.size > MAX_CODE_STATE_FILE_BYTES) throw new Error("file-too-large")
  const bytes = await readFile(absolute)
  return { bytes, mode: info.mode & 0o111 ? "100755" : "100644" }
}

/**
 * Records changes in the index against HEAD, the worktree against the index, and untracked files.
 * The interval between capturedAt and completedAt is observable: Git has no atomic snapshot of
 * simultaneously changing index and working-tree files. `complete` means every detected path was
 * captured within the size limits and no status drift was detected during this interval.
 */
export const captureGitCodeState = async (
  cwd: string,
  phase: "start" | "end" | "review",
  sessionId: string,
): Promise<CodeStateSnapshot> => {
  const capturedAt = new Date().toISOString()
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS
  const runGit = (dir: string, args: ReadonlyArray<string>): Promise<Buffer> => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error("code-state-capture-timeout")
    return git(dir, args, remaining)
  }
  const runGitText = async (dir: string, args: ReadonlyArray<string>): Promise<string> =>
    (await runGit(dir, args)).toString("utf8").trim()
  const absoluteCwd = resolve(cwd)
  const repoRoot = await runGitText(absoluteCwd, ["rev-parse", "--show-toplevel"])
  const headSha = await runGitText(repoRoot, ["rev-parse", "HEAD"])
  if (!/^[a-f0-9]{40,64}$/.test(headSha)) throw new Error("Git HEAD is not a commit SHA")
  const omissions: CodeStateOmission[] = []
  const files: CodeStateFile[] = []
  let totalBytes = 0
  const before = await runGit(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
  const indexBefore = await runGit(repoRoot, ["ls-files", "--stage", "-z"])
  const index = indexEntries(indexBefore, omissions)
  const stagedNames = nullFields(
    await runGit(repoRoot, [
      "diff",
      "--cached",
      "--name-only",
      "-z",
      "--no-ext-diff",
      "--no-renames",
    ]),
  )
  const worktreeNames = nullFields(
    await runGit(repoRoot, ["diff", "--name-only", "-z", "--no-ext-diff", "--no-renames"]),
  )
  const untrackedNames = nullFields(
    await runGit(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
  )
  const stagedRenames = renameHints(
    await runGit(repoRoot, ["diff", "--cached", "--name-status", "-z", "-M", "--no-ext-diff"]),
  )
  const worktreeRenames = renameHints(
    await runGit(repoRoot, ["diff", "--name-status", "-z", "-M", "--no-ext-diff"]),
  )
  const totalPaths = stagedNames.length + worktreeNames.length + untrackedNames.length
  if (totalPaths > MAX_CODE_STATE_PATHS)
    omissions.push({ reason: `path-count-limit:${totalPaths - MAX_CODE_STATE_PATHS}` })
  let pathsRemaining = MAX_CODE_STATE_PATHS

  const addFile = (
    path: string,
    layer: Layer,
    bytes: Buffer,
    mode: string,
    hint?: string,
  ): void => {
    if (bytes.byteLength > MAX_CODE_STATE_FILE_BYTES) {
      omissions.push({ path, layer, reason: "file-too-large" })
      return
    }
    if (totalBytes + bytes.byteLength > MAX_CODE_STATE_TOTAL_BYTES) {
      omissions.push({ path, layer, reason: "total-size-limit" })
      return
    }
    totalBytes += bytes.byteLength
    files.push({
      path,
      layer,
      kind: "file",
      contentBase64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      mode,
      ...(hint ? { previousPath: hint } : {}),
    })
  }

  for (const path of stagedNames) {
    if (pathsRemaining-- <= 0) break
    if (!safeRelative(repoRoot, path)) {
      omissions.push({ layer: "index", reason: "unsafe-path" })
      continue
    }
    const skip = excluded(path)
    if (skip) {
      omissions.push({ path, layer: "index", reason: skip })
      continue
    }
    const entry = index.get(path)
    if (!entry) {
      if (
        omissions.some(
          (omission) => omission.path === path && omission.reason === "unmerged-index-entry",
        )
      )
        continue
      files.push({ path, layer: "index", kind: "deletion" })
      continue
    }
    if (entry.mode === "160000") {
      omissions.push({ path, layer: "index", reason: "submodule" })
      continue
    }
    try {
      const size = Number(await runGitText(repoRoot, ["cat-file", "-s", entry.oid]))
      if (size > MAX_CODE_STATE_FILE_BYTES) {
        omissions.push({ path, layer: "index", reason: "file-too-large" })
        continue
      }
      addFile(
        path,
        "index",
        await runGit(repoRoot, ["cat-file", "blob", entry.oid]),
        entry.mode,
        stagedRenames.get(path),
      )
    } catch {
      omissions.push({ path, layer: "index", reason: "index-read-failed" })
    }
  }

  for (const [layer, names] of [
    ["worktree", worktreeNames],
    ["untracked", untrackedNames],
  ] as const) {
    for (const path of names) {
      if (pathsRemaining-- <= 0) break
      if (!safeRelative(repoRoot, path)) {
        omissions.push({ layer, reason: "unsafe-path" })
        continue
      }
      const skip = excluded(path)
      if (skip) {
        omissions.push({ path, layer, reason: skip })
        continue
      }
      try {
        const file = await contentFile(repoRoot, path)
        if (!file) {
          if (layer === "worktree") files.push({ path, layer, kind: "deletion" })
          else omissions.push({ path, layer, reason: "vanished-during-capture" })
          continue
        }
        addFile(path, layer, file.bytes, file.mode, worktreeRenames.get(path))
      } catch (error) {
        omissions.push({
          path,
          layer,
          reason:
            error instanceof Error && error.message === "file-too-large"
              ? "file-too-large"
              : "file-read-failed",
        })
      }
    }
  }

  try {
    const after = await runGit(repoRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ])
    const indexAfter = await runGit(repoRoot, ["ls-files", "--stage", "-z"])
    const finalHead = await runGitText(repoRoot, ["rev-parse", "HEAD"])
    if (!before.equals(after) || !indexBefore.equals(indexAfter) || headSha !== finalHead)
      omissions.push({ reason: "state-changed-during-capture" })
    for (const file of files) {
      if (file.kind !== "file" || file.layer === "index") continue
      if (Date.now() >= deadline) {
        omissions.push({ reason: "consistency-check-timed-out" })
        break
      }
      try {
        const current = await contentFile(repoRoot, file.path)
        if (
          !current ||
          current.mode !== file.mode ||
          createHash("sha256").update(current.bytes).digest("hex") !== file.sha256
        ) {
          omissions.push({
            path: file.path,
            layer: file.layer,
            reason: "file-changed-during-capture",
          })
        }
      } catch {
        omissions.push({
          path: file.path,
          layer: file.layer,
          reason: "file-unverifiable-after-capture",
        })
      }
    }
  } catch {
    omissions.push({ reason: "consistency-check-failed-or-timed-out" })
  }
  return {
    version: 1,
    sessionId,
    phase,
    captureId: randomUUID(),
    capturedAt,
    completedAt: new Date().toISOString(),
    cwd: absoluteCwd,
    repoRoot,
    headSha,
    complete: omissions.length === 0,
    files,
    omissions,
  }
}
