import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { captureGitCodeState, codeStateSnapshotSchema } from "./code-state-capture.js"

const dirs: string[] = []
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

const repo = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "samskara-code-state-"))
  dirs.push(dir)
  git(dir, "init", "-q")
  git(dir, "config", "user.email", "test@example.com")
  git(dir, "config", "user.name", "Test")
  await writeFile(join(dir, "staged.txt"), "old staged\n")
  await writeFile(join(dir, "worktree.txt"), "old worktree\n")
  await writeFile(join(dir, "removed.txt"), "remove me\n")
  await writeFile(join(dir, "rename.txt"), "rename me\n")
  git(dir, "add", ".")
  git(dir, "commit", "-qm", "initial")
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("captureGitCodeState", () => {
  test("captures index, worktree, untracked and deletion layers with rename hints", async () => {
    const dir = await repo()
    await writeFile(join(dir, "staged.txt"), "staged version\n")
    git(dir, "add", "staged.txt")
    await writeFile(join(dir, "staged.txt"), "later worktree version\n")
    await rm(join(dir, "removed.txt"))
    git(dir, "add", "removed.txt")
    git(dir, "mv", "rename.txt", "renamed.txt")
    await writeFile(join(dir, "untracked.txt"), "new file\n")
    await writeFile(join(dir, "worktree.txt"), "unstaged version\n")

    const result = await captureGitCodeState(dir, "start", "session-1")
    expect(codeStateSnapshotSchema.safeParse(result).success).toBe(true)
    expect(result.headSha).toBe(git(dir, "rev-parse", "HEAD"))
    expect(result.complete).toBe(true)
    expect(result.files.map(({ layer, kind, path }) => `${layer}:${kind}:${path}`)).toEqual(
      expect.arrayContaining([
        "index:file:staged.txt",
        "index:deletion:removed.txt",
        "index:deletion:rename.txt",
        "index:file:renamed.txt",
        "worktree:file:staged.txt",
        "worktree:file:worktree.txt",
        "untracked:file:untracked.txt",
      ]),
    )
    const index = result.files.find((file) => file.layer === "index" && file.path === "staged.txt")
    const worktree = result.files.find(
      (file) => file.layer === "worktree" && file.path === "staged.txt",
    )
    expect(Buffer.from(index?.contentBase64 ?? "", "base64").toString()).toBe("staged version\n")
    expect(Buffer.from(worktree?.contentBase64 ?? "", "base64").toString()).toBe(
      "later worktree version\n",
    )
    expect(result.files.find((file) => file.path === "renamed.txt")?.previousPath).toBe(
      "rename.txt",
    )
  })

  test("records omitted large files and symlink mode without following the link", async () => {
    const dir = await repo()
    await writeFile(join(dir, "huge.txt"), Buffer.alloc(1024 * 1024 + 1, 65))
    await symlink("staged.txt", join(dir, "shortcut"))
    const result = await captureGitCodeState(dir, "review", "session-2")
    expect(result.complete).toBe(false)
    expect(result.omissions).toContainEqual(
      expect.objectContaining({ path: "huge.txt", layer: "untracked", reason: "file-too-large" }),
    )
    const link = result.files.find((file) => file.path === "shortcut")
    expect(link?.mode).toBe("120000")
    expect(Buffer.from(link?.contentBase64 ?? "", "base64").toString()).toBe("staged.txt")
    expect(await readFile(join(dir, "staged.txt"), "utf8")).toBe("old staged\n")
  })

  test("omits sensitive and generated files while recording their paths", async () => {
    const dir = await repo()
    await writeFile(join(dir, ".env.local"), "PRIVATE_TOKEN=do-not-upload\n")
    await mkdir(join(dir, "generated"))
    await writeFile(join(dir, "generated", "schema.ts"), "generated content\n")
    const result = await captureGitCodeState(dir, "start", "session-3")
    expect(result.complete).toBe(false)
    expect(result.files.some((file) => file.path === ".env.local")).toBe(false)
    expect(result.files.some((file) => file.path === "generated/schema.ts")).toBe(false)
    expect(result.omissions).toEqual(
      expect.arrayContaining([
        { path: ".env.local", layer: "untracked", reason: "sensitive-file" },
        { path: "generated/schema.ts", layer: "untracked", reason: "generated-or-dependency" },
      ]),
    )
    expect(JSON.stringify(result)).not.toContain("do-not-upload")
  })

  test("records a SessionEnd capture as the end phase", async () => {
    const dir = await repo()
    const result = await captureGitCodeState(dir, "end", "session-end")
    expect(result.phase).toBe("end")
    expect(codeStateSnapshotSchema.safeParse(result).success).toBe(true)
  })
})
