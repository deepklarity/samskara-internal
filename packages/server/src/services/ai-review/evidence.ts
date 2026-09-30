import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join } from "node:path"
import { promisify } from "node:util"
import type { CodeStateSnapshot } from "@samskara/core"
import { and, asc, eq, sql } from "drizzle-orm"
import type { Querier } from "../../db/client.js"
import { artifact, commits, messages, projects, repos, sessions } from "../../db/schema.js"
import { visibleToUser } from "../../repositories/projects.repo.js"

const exec = promisify(execFile)
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TREE_BYTES = 40 * 1024 * 1024
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024
const MAX_PATCH_BYTES = 2 * 1024 * 1024
const SHA = /^[a-fA-F0-9]{40}(?:[a-fA-F0-9]{24})?$/

export type EvidenceRepo = {
  readonly host: string
  readonly owner: string
  readonly repoName: string
}
export type RepoCandidate = EvidenceRepo & { readonly source: "project" | "first-message" }
export type ReviewEvidenceInput = {
  readonly sessionId: string
  readonly capturedAt: string
  readonly origin: {
    readonly cwd: string | null
    readonly startCommit: string | null
    readonly repoCandidates: ReadonlyArray<RepoCandidate>
  }
  readonly commits: ReadonlyArray<{
    readonly sha: string
    readonly repo: EvidenceRepo
    readonly messageId: string | null
    readonly recordedAt: string
  }>
  readonly artifacts: ReadonlyArray<{
    readonly id: string
    readonly path: string
    readonly relativePath: string
    readonly changeKind: string
    readonly isBinary: boolean
    readonly baseContent: Buffer | null
    readonly currentContent: Buffer | null
    readonly currentHash: string
    readonly lastSeenAt: string
  }>
  readonly startState?: CodeStateSnapshot | null
  readonly endState?: CodeStateSnapshot | null
  readonly reviewState?: CodeStateSnapshot | null
}

export type EvidenceOmission = {
  readonly source: "tree" | "artifact" | "commit" | "code-state"
  readonly path: string
  readonly reason: string
  /** Identifies the reconstructed tree for tree and code-state omissions. */
  readonly phase?: "start" | "after"
}
export type StagedFile = { readonly path: string; readonly sha256: string; readonly bytes: number }
export type EvidenceCitation = {
  readonly repo: string
  /** Repository-relative path for tree files, recorded artifact path for artifacts. */
  readonly path: string
  readonly revision: string
  readonly sha256: string
  readonly kind:
    | "start-tree"
    | "review-tree"
    | "code-state-index"
    | "code-state-worktree"
    | "code-state-untracked"
    | "code-state-deletion"
    | "artifact-base"
    | "artifact-current"
    | "commit-patch"
  readonly lines?: number
  readonly stagedPath: string
}
export type ReviewEvidenceManifest = {
  readonly sessionId: string
  readonly capturedAt: string
  readonly startCommit: string | null
  readonly repo: EvidenceRepo | null
  readonly tree: {
    readonly available: boolean
    readonly source: "local" | "remote" | "none"
    readonly reason?: string
    readonly confidence: "best-known" | "unavailable"
    readonly files: ReadonlyArray<StagedFile>
    readonly artifactBaseOverlays: ReadonlyArray<StagedFile>
    readonly omissions: ReadonlyArray<EvidenceOmission>
  }
  readonly states?: {
    readonly start?: CodeStateManifest
    readonly end?: CodeStateManifest
    readonly review?: CodeStateManifest
    readonly afterSource: "session-end" | "review-time" | "none"
    readonly afterTree?: {
      readonly available: boolean
      readonly files: ReadonlyArray<StagedFile>
      readonly omissions: ReadonlyArray<EvidenceOmission>
    }
  }
  readonly artifacts: ReadonlyArray<{
    readonly id: string
    readonly path: string
    readonly currentHash: string
    readonly lastSeenAt: string
    readonly base?: StagedFile
    readonly current?: StagedFile
  }>
  readonly commits: ReadonlyArray<{
    readonly sha: string
    readonly messageId: string | null
    readonly recordedAt: string
    readonly patch?: StagedFile
  }>
  readonly omissions: ReadonlyArray<EvidenceOmission>
  readonly citations: ReadonlyArray<EvidenceCitation>
  readonly notes: ReadonlyArray<string>
}

type CodeStateManifest = Pick<
  CodeStateSnapshot,
  "captureId" | "phase" | "capturedAt" | "completedAt" | "headSha" | "complete" | "omissions"
> & {
  readonly files: ReadonlyArray<Omit<CodeStateSnapshot["files"][number], "contentBase64">>
}

/** Authorized, frozen-at-read evidence for one review. No repository bytes enter this query. */
export const getReviewEvidence = async (
  db: Querier,
  userId: string,
  sessionId: string,
): Promise<ReviewEvidenceInput | null> => {
  const [origin] = await db
    .select({
      cwd: sessions.cwd,
      startCommit: sessions.startCommit,
      projectRepoId: projects.repoId,
    })
    .from(sessions)
    .innerJoin(projects, eq(projects.id, sessions.projectId))
    .where(and(eq(sessions.id, sessionId), visibleToUser(db, userId)))
  if (!origin) return null

  const [projectRepo, firstMessageRepos, commitRows, artifactRows] = await Promise.all([
    origin.projectRepoId
      ? db
          .select({ host: repos.host, owner: repos.owner, repoName: repos.repoName })
          .from(repos)
          .where(eq(repos.id, origin.projectRepoId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ host: repos.host, owner: repos.owner, repoName: repos.repoName })
      .from(messages)
      .innerJoin(repos, eq(repos.id, messages.repoId))
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.lineNumber), asc(messages.subIndex))
      .limit(1),
    db
      .select({
        sha: commits.sha,
        messageId: commits.messageId,
        recordedAt: sql<string>`${commits.createdAt}`,
        host: repos.host,
        owner: repos.owner,
        repoName: repos.repoName,
      })
      .from(commits)
      .innerJoin(repos, eq(repos.id, commits.repoId))
      .where(eq(commits.sessionId, sessionId))
      .orderBy(asc(commits.createdAt), asc(commits.sha)),
    db
      .select({
        id: artifact.id,
        path: artifact.path,
        relativePath: artifact.relativePath,
        changeKind: artifact.changeKind,
        isBinary: artifact.isBinary,
        baseContent: sql<Buffer | null>`case when not ${artifact.isBinary} and octet_length(${artifact.baseContent}) <= ${MAX_ARTIFACT_BYTES} then ${artifact.baseContent} else null end`,
        currentContent: sql<Buffer | null>`case when not ${artifact.isBinary} and octet_length(${artifact.currentContent}) <= ${MAX_ARTIFACT_BYTES} then ${artifact.currentContent} else null end`,
        currentHash: artifact.currentHash,
        lastSeenAt: sql<string>`${artifact.lastSeenAt}`,
      })
      .from(artifact)
      .where(eq(artifact.sessionId, sessionId))
      .orderBy(asc(artifact.relativePath)),
  ])
  const repoCandidates: RepoCandidate[] = []
  if (projectRepo[0]) repoCandidates.push({ ...projectRepo[0], source: "project" })
  if (firstMessageRepos[0])
    repoCandidates.push({ ...firstMessageRepos[0], source: "first-message" })
  return {
    sessionId,
    capturedAt: new Date().toISOString(),
    origin: { cwd: origin.cwd, startCommit: origin.startCommit, repoCandidates },
    commits: commitRows.map(({ host, owner, repoName, ...row }) => ({
      ...row,
      repo: { host, owner, repoName },
    })),
    artifacts: artifactRows,
  }
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex")
const safeRelative = (path: string): boolean =>
  path.length > 0 &&
  !isAbsolute(path) &&
  !path.split(/[\\/]/).some((part) => part === ".." || part === "" || part === ".")

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
    name === ".env" ||
    name.startsWith(".env.") ||
    /(^|[._-])(secret|password|credential|private-key)([._-]|$)/i.test(name) ||
    /\.(pem|p12|pfx|key)$/i.test(name)
  )
    return "sensitive-file"
  return null
}
const git = async (
  cwd: string,
  args: string[],
  maxBuffer = MAX_FILE_BYTES + 4096,
): Promise<Buffer> => {
  const { stdout } = await exec("git", args, {
    cwd,
    encoding: "buffer",
    maxBuffer,
    timeout: 15_000,
  })
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
}
const gitText = async (cwd: string, args: string[]): Promise<string> =>
  (await git(cwd, args, 4 * 1024 * 1024)).toString("utf8").trim()
const fetchCommit = async (cwd: string, remote: string, sha: string): Promise<void> => {
  await exec("git", ["fetch", "--no-tags", "--depth=1", remote, sha], {
    cwd,
    encoding: "buffer",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 15_000,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never",
      GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
    },
  })
}
const parseRemote = (url: string): EvidenceRepo | null => {
  const clean = url.trim().replace(/\.git$/, "")
  const ssh = /^git@([^:]+):([^/]+)\/(.+)$/.exec(clean)
  const https = /^https?:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(clean)
  const match = ssh ?? https
  return match?.[1] && match[2] && match[3]
    ? { host: match[1], owner: match[2], repoName: match[3] }
    : null
}
const sameRepo = (a: EvidenceRepo, b: EvidenceRepo) =>
  a.host.toLowerCase() === b.host.toLowerCase() &&
  a.owner.toLowerCase() === b.owner.toLowerCase() &&
  a.repoName.toLowerCase() === b.repoName.toLowerCase()
const repoLabel = (repo: EvidenceRepo): string => `${repo.host}/${repo.owner}/${repo.repoName}`
const fileRecord = (path: string, bytes: Buffer): StagedFile => ({
  path,
  sha256: sha256(bytes),
  bytes: bytes.byteLength,
})
const linesOf = (bytes: Buffer): number =>
  bytes.length === 0 ? 0 : bytes.toString("utf8").split("\n").length - (bytes.at(-1) === 10 ? 1 : 0)

const stateManifest = (state: CodeStateSnapshot): CodeStateManifest => ({
  captureId: state.captureId,
  phase: state.phase,
  capturedAt: state.capturedAt,
  completedAt: state.completedAt,
  headSha: state.headSha,
  complete: state.complete,
  omissions: state.omissions,
  files: state.files.map(({ contentBase64: _content, ...file }) => file),
})

/** Materialize tracked text at a specific revision without changing the developer checkout. */
const stageTrackedTree = async (
  root: string,
  revision: string,
  destination: string,
  stagedPrefix: string,
  repo: EvidenceRepo | null,
  kind: "start-tree" | "review-tree",
  omissions: EvidenceOmission[],
  citations: EvidenceCitation[],
): Promise<StagedFile[]> => {
  const files: StagedFile[] = []
  const listing = await git(
    root,
    ["ls-tree", "-r", "-z", "--full-tree", revision],
    16 * 1024 * 1024,
  )
  let total = 0
  for (const entry of listing.toString("utf8").split("\0")) {
    if (!entry) continue
    const match = /^(\d{6}) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry)
    if (!match) continue
    const [, mode, type, objectId, path] = match
    if (!path || !safeRelative(path)) {
      omissions.push({ source: "tree", path: path ?? entry, reason: "unsafe-path" })
      continue
    }
    const skip = excluded(path)
    if (skip) {
      omissions.push({ source: "tree", path, reason: skip })
      continue
    }
    if (mode !== "100644" && mode !== "100755") {
      omissions.push({ source: "tree", path, reason: "non-regular-file" })
      continue
    }
    if (type !== "blob" || !objectId) continue
    const size = Number(await gitText(root, ["cat-file", "-s", objectId]))
    if (size > MAX_FILE_BYTES || total + size > MAX_TREE_BYTES) {
      omissions.push({ source: "tree", path, reason: "size-limit" })
      continue
    }
    const bytes = await git(root, ["cat-file", "blob", objectId])
    if (bytes.includes(0)) {
      omissions.push({ source: "tree", path, reason: "binary-file" })
      continue
    }
    const target = join(destination, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes, { mode: 0o444 })
    files.push(fileRecord(path, bytes))
    if (repo)
      citations.push({
        repo: repoLabel(repo),
        path,
        revision,
        sha256: sha256(bytes),
        kind,
        lines: linesOf(bytes),
        stagedPath: `${stagedPrefix}/${path}`,
      })
    total += bytes.byteLength
  }
  return files
}

/** Apply index, then worktree, then untracked bytes to a reconstructed commit tree. */
const overlayCodeState = async (
  state: CodeStateSnapshot,
  targetDir: string,
  treeDir: string,
  treePrefix: string,
  files: StagedFile[],
  repo: EvidenceRepo | null,
  omissions: EvidenceOmission[],
  citations: EvidenceCitation[],
): Promise<void> => {
  const byPath = new Map(files.map((file) => [file.path, file]))
  const order = { index: 0, worktree: 1, untracked: 2 }
  for (const file of [...state.files].sort((a, b) => order[a.layer] - order[b.layer])) {
    if (!safeRelative(file.path)) {
      omissions.push({ source: "code-state", path: file.path, reason: "unsafe-path" })
      continue
    }
    const skip = excluded(file.path)
    if (skip) {
      omissions.push({ source: "code-state", path: file.path, reason: skip })
      continue
    }
    const target = join(treeDir, file.path)
    if (file.kind === "deletion") {
      await rm(target, { force: true })
      byPath.delete(file.path)
      for (let i = citations.length - 1; i >= 0; i--) {
        if (citations[i]?.path === file.path && citations[i]?.stagedPath.startsWith(treePrefix))
          citations.splice(i, 1)
      }
      if (repo)
        citations.push({
          repo: repoLabel(repo),
          path: file.path,
          revision: `${state.captureId}:${file.layer}:deleted`,
          sha256: sha256("deleted"),
          kind: "code-state-deletion",
          stagedPath: `states/${state.phase}.json`,
        })
      continue
    }
    if (file.mode === "120000") {
      omissions.push({ source: "code-state", path: file.path, reason: "symlink-not-materialized" })
      continue
    }
    const bytes = file.contentBase64 ? Buffer.from(file.contentBase64, "base64") : null
    if (bytes === null || bytes.byteLength > MAX_FILE_BYTES || sha256(bytes) !== file.sha256) {
      omissions.push({ source: "code-state", path: file.path, reason: "missing-or-invalid-bytes" })
      continue
    }
    if (bytes.includes(0)) {
      omissions.push({ source: "code-state", path: file.path, reason: "binary-file" })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await rm(target, { force: true })
    await writeFile(target, bytes, { mode: 0o444 })
    byPath.set(file.path, fileRecord(file.path, bytes))
    const layerPath = `states/${state.phase}/${file.layer}/${file.path}`
    await mkdir(dirname(join(targetDir, layerPath)), { recursive: true })
    await writeFile(join(targetDir, layerPath), bytes, { mode: 0o444 })
    for (let i = citations.length - 1; i >= 0; i--) {
      if (citations[i]?.path === file.path && citations[i]?.stagedPath.startsWith(treePrefix))
        citations.splice(i, 1)
    }
    if (repo) {
      citations.push({
        repo: repoLabel(repo),
        path: file.path,
        revision: `${state.captureId}:${file.layer}:${file.sha256}`,
        sha256: file.sha256,
        kind: `code-state-${file.layer}`,
        lines: linesOf(bytes),
        stagedPath: layerPath,
      })
    }
  }
  files.splice(0, files.length, ...byPath.values())
  await mkdir(join(targetDir, "states"), { recursive: true })
  await writeFile(
    join(targetDir, "states", `${state.phase}.json`),
    `${JSON.stringify(stateManifest(state), null, 2)}\n`,
    {
      mode: 0o444,
    },
  )
}

/** Stages immutable historical bytes outside the writable review workspace. Never checks out HEAD. */
export const stageReviewEvidence = async (
  input: ReviewEvidenceInput,
  targetDir: string,
): Promise<{ readonly codeDir: string; readonly manifest: ReviewEvidenceManifest }> => {
  const omissions: EvidenceOmission[] = []
  const startTreeOmissions: EvidenceOmission[] = []
  const afterTreeOmissions: EvidenceOmission[] = []
  const files: StagedFile[] = []
  const overlays: StagedFile[] = []
  const stagedArtifacts: ReviewEvidenceManifest["artifacts"][number][] = []
  const stagedCommits: ReviewEvidenceManifest["commits"][number][] = []
  const citations: EvidenceCitation[] = []
  const notes = [
    "The historical tree is reconstructed from the captured start state when available. Artifact bases and commits remain separate attribution evidence.",
    "A review-time working tree can include changes outside this session; only session artifacts, commits, and transcript events support attribution.",
    "Artifact capture is best-effort.",
  ]
  if (!input.startState)
    notes.push(
      "No SessionStart working-tree capture is available; the starting tree uses the best-known commit only.",
    )
  if (!input.endState && !input.reviewState)
    notes.push(
      "No end or review-time working-tree capture is available; an after tree cannot be shown.",
    )
  const treeDir = join(targetDir, "tree")
  await mkdir(treeDir, { recursive: true })
  await mkdir(join(targetDir, "artifacts"), { recursive: true })
  const { cwd, repoCandidates } = input.origin
  const startCommit = input.startState?.headSha ?? input.origin.startCommit
  const recordedRepo: EvidenceRepo | null = repoCandidates[0] ?? null
  let root: string | null = null
  let repo: EvidenceRepo | null = null
  let verifiedRemoteUrl: string | null = null
  let reason: string | undefined
  if (!cwd || !startCommit || !SHA.test(startCommit)) reason = "missing-origin-or-start-commit"
  else {
    try {
      root = await gitText(cwd, ["rev-parse", "--show-toplevel"])
      const remote = await gitText(root, ["config", "--get", "remote.origin.url"]).catch(() => "")
      const commonDir = await gitText(root, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ])
      const localOwner = dirname(commonDir)
      repo = parseRemote(remote) ?? {
        host: "local",
        owner: localOwner,
        repoName: basename(localOwner),
      }
      if (
        repoCandidates.length > 0 &&
        !repoCandidates.some((candidate) => repo !== null && sameRepo(candidate, repo))
      )
        reason = "repository-identity-mismatch"
      else {
        if (repoCandidates.length === 0)
          notes.push(
            "No stored repository identity was available; the recorded checkout path and start commit are the only origin checks.",
          )
        verifiedRemoteUrl = remote || null
        await git(root, ["cat-file", "-e", `${startCommit}^{commit}`])
      }
    } catch {
      reason = root ? "start-commit-unavailable" : "local-checkout-unavailable"
    }
  }
  // A disappeared checkout or GC'd commit may still be recoverable through the developer's
  // existing Git credentials. The temporary object store is host-only and removed below.
  let fetchedDir: string | undefined
  if (reason && startCommit && SHA.test(startCommit)) {
    const candidate = repoCandidates.find((item) => item.host.toLowerCase() === "github.com")
    if (candidate) {
      try {
        fetchedDir = await mkdtemp(join(tmpdir(), "samskara-review-fetch-"))
        await git(fetchedDir, ["init", "--bare", "-q"])
        const remote =
          verifiedRemoteUrl ??
          `https://github.com/${encodeURIComponent(candidate.owner)}/${encodeURIComponent(candidate.repoName)}.git`
        await fetchCommit(fetchedDir, remote, startCommit)
        await git(fetchedDir, ["cat-file", "-e", `${startCommit}^{commit}`])
        root = fetchedDir
        repo = candidate
        reason = undefined
        notes.push(
          "The start commit was fetched using host Git credentials because the local checkout was unavailable or incomplete.",
        )
      } catch {
        if (fetchedDir) await rm(fetchedDir, { recursive: true, force: true })
        fetchedDir = undefined
      }
    }
  }
  try {
    if (!reason && root && startCommit) {
      try {
        files.push(
          ...(await stageTrackedTree(
            root,
            startCommit,
            treeDir,
            "tree",
            repo,
            "start-tree",
            startTreeOmissions,
            citations,
          )),
        )
        if (input.startState)
          await overlayCodeState(
            input.startState,
            targetDir,
            treeDir,
            "tree/",
            files,
            repo,
            startTreeOmissions,
            citations,
          )
      } catch {
        reason = "tree-staging-failed"
        notes.push(
          "The historical tree could not be staged completely; staged files may be partial.",
        )
      }
    }

    const afterState = input.endState ?? input.reviewState
    let afterTreeFiles: StagedFile[] | undefined
    if (!reason && root && repo && afterState) {
      try {
        await git(root, ["cat-file", "-e", `${afterState.headSha}^{commit}`])
        const afterTreeDir = join(targetDir, "after", "tree")
        await mkdir(afterTreeDir, { recursive: true })
        afterTreeFiles = await stageTrackedTree(
          root,
          afterState.headSha,
          afterTreeDir,
          "after/tree",
          repo,
          "review-tree",
          afterTreeOmissions,
          citations,
        )
        await overlayCodeState(
          afterState,
          targetDir,
          afterTreeDir,
          "after/tree/",
          afterTreeFiles,
          repo,
          afterTreeOmissions,
          citations,
        )
      } catch {
        notes.push("The captured after working tree could not be reconstructed completely.")
      }
    }

    for (const artifactRow of input.artifacts) {
      const artifactPath = artifactRow.relativePath
      if (!safeRelative(artifactPath) || !/^[a-zA-Z0-9_-]+$/.test(artifactRow.id)) {
        omissions.push({ source: "artifact", path: artifactPath, reason: "unsafe-path" })
        continue
      }
      const artifactExclusion = excluded(artifactPath)
      if (artifactExclusion) {
        omissions.push({ source: "artifact", path: artifactPath, reason: artifactExclusion })
        continue
      }
      const record: {
        id: string
        path: string
        currentHash: string
        lastSeenAt: string
        base?: StagedFile
        current?: StagedFile
      } = {
        id: artifactRow.id,
        path: artifactPath,
        currentHash: artifactRow.currentHash,
        lastSeenAt: artifactRow.lastSeenAt,
      }
      const artifactDir = join(targetDir, "artifacts", artifactRow.id)
      await mkdir(artifactDir, { recursive: true })
      for (const side of ["base", "current"] as const) {
        const bytes = side === "base" ? artifactRow.baseContent : artifactRow.currentContent
        if (!bytes || artifactRow.isBinary || bytes.includes(0)) {
          omissions.push({
            source: "artifact",
            path: artifactPath,
            reason: `${side}-unavailable-or-binary`,
          })
          continue
        }
        if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
          omissions.push({ source: "artifact", path: artifactPath, reason: `${side}-size-limit` })
          continue
        }
        if (side === "current" && sha256(bytes) !== artifactRow.currentHash) {
          omissions.push({ source: "artifact", path: artifactPath, reason: "hash-mismatch" })
          continue
        }
        const stagedPath = `artifacts/${artifactRow.id}/${side}`
        await writeFile(join(targetDir, stagedPath), bytes, { mode: 0o444 })
        await chmod(join(targetDir, stagedPath), 0o444)
        record[side] = fileRecord(stagedPath, bytes)
        if (recordedRepo)
          citations.push({
            repo: repoLabel(recordedRepo),
            path: artifactPath,
            revision: `${artifactRow.id}:${side}:${sha256(bytes)}`,
            sha256: sha256(bytes),
            kind: side === "base" ? "artifact-base" : "artifact-current",
            lines: linesOf(bytes),
            stagedPath,
          })
      }
      stagedArtifacts.push(record)
      if (artifactRow.baseContent && artifactRow.changeKind === "edited")
        notes.push(
          `Artifact ${artifactRow.id} has pre-first-edit bytes; their timing relative to session start is unverified.`,
        )
    }

    for (const commit of input.commits) {
      const record: {
        sha: string
        messageId: string | null
        recordedAt: string
        patch?: StagedFile
      } = {
        sha: commit.sha,
        messageId: commit.messageId,
        recordedAt: commit.recordedAt,
      }
      if (!reason && root && repo && sameRepo(repo, commit.repo) && SHA.test(commit.sha)) {
        try {
          const changed = await gitText(root, [
            "diff-tree",
            "--no-commit-id",
            "--name-only",
            "-r",
            commit.sha,
          ])
          if (changed.split("\n").some((path) => path && excluded(path)))
            throw new Error("sensitive-or-generated-path")
          const patch = await git(
            root,
            ["show", "--format=fuller", "--no-ext-diff", "--no-renames", commit.sha],
            MAX_PATCH_BYTES,
          )
          const path = `commits/${commit.sha}.patch`
          await mkdir(join(targetDir, "commits"), { recursive: true })
          await writeFile(join(targetDir, path), patch, { mode: 0o444 })
          record.patch = fileRecord(path, patch)
          citations.push({
            repo: repoLabel(repo),
            path: `${commit.sha}.patch`,
            revision: commit.sha,
            sha256: sha256(patch),
            kind: "commit-patch",
            lines: linesOf(patch),
            stagedPath: path,
          })
        } catch {
          omissions.push({
            source: "commit",
            path: commit.sha,
            reason: "patch-unavailable-or-size-limit",
          })
        }
      } else
        omissions.push({
          source: "commit",
          path: commit.sha,
          reason: "checkout-or-revision-unavailable",
        })
      stagedCommits.push(record)
    }
    await writeFile(
      join(targetDir, "commits.json"),
      `${JSON.stringify(stagedCommits, null, 2)}\n`,
      { mode: 0o444 },
    )
    if (reason && recordedRepo)
      notes.push(
        "Artifact repository identity comes from stored session attribution; artifact paths may not all belong to that repository.",
      )
    const startOmissions = [
      ...startTreeOmissions,
      ...(input.startState?.omissions.map((item) => ({
        source: "code-state" as const,
        path: item.path ?? "(capture)",
        reason: item.reason,
      })) ?? []),
    ].map((item) => ({ ...item, phase: "start" as const }))
    const afterOmissions = [
      ...afterTreeOmissions,
      ...(afterState?.omissions.map((item) => ({
        source: "code-state" as const,
        path: item.path ?? "(capture)",
        reason: item.reason,
      })) ?? []),
    ].map((item) => ({ ...item, phase: "after" as const }))
    const manifest: ReviewEvidenceManifest = {
      sessionId: input.sessionId,
      capturedAt: input.capturedAt,
      startCommit,
      repo: reason ? recordedRepo : repo,
      tree: {
        available:
          reason === undefined &&
          (input.startState?.complete ?? true) &&
          startOmissions.length === 0,
        source:
          reason === undefined || reason === "tree-staging-failed"
            ? fetchedDir
              ? "remote"
              : "local"
            : "none",
        ...(reason
          ? { reason }
          : startOmissions.length > 0 ||
              (input.startState !== null &&
                input.startState !== undefined &&
                !input.startState.complete)
            ? { reason: "partial-tree" }
            : {}),
        confidence: reason ? "unavailable" : "best-known",
        files,
        artifactBaseOverlays: overlays,
        omissions: startOmissions,
      },
      states: {
        ...(input.startState === null || input.startState === undefined
          ? {}
          : { start: stateManifest(input.startState) }),
        ...(input.reviewState === null || input.reviewState === undefined
          ? {}
          : { review: stateManifest(input.reviewState) }),
        ...(input.endState === null || input.endState === undefined
          ? {}
          : { end: stateManifest(input.endState) }),
        afterSource: input.endState ? "session-end" : input.reviewState ? "review-time" : "none",
        ...(afterTreeFiles === undefined
          ? {}
          : {
              afterTree: {
                available: (afterState?.complete ?? false) && afterOmissions.length === 0,
                files: afterTreeFiles,
                omissions: afterOmissions,
              },
            }),
      },
      artifacts: stagedArtifacts,
      commits: stagedCommits,
      omissions: [...startOmissions, ...afterOmissions, ...omissions],
      citations,
      notes,
    }
    await writeFile(
      join(targetDir, "evidence-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o444 },
    )
    return { codeDir: targetDir, manifest }
  } finally {
    if (fetchedDir) await rm(fetchedDir, { recursive: true, force: true })
  }
}
