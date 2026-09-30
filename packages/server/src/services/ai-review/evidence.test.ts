import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureGitCodeState } from "@samskara/core"
import { afterEach, describe, expect, test } from "vitest"
import { type ReviewEvidenceInput, stageReviewEvidence } from "./evidence.js"

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const temp = async () => {
  const dir = await mkdtemp(join(tmpdir(), "samskara-evidence-test-"))
  dirs.push(dir)
  return dir
}
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex")

const fixture = async () => {
  const root = await temp()
  git(root, "init", "-q")
  git(root, "config", "user.email", "review@example.test")
  git(root, "config", "user.name", "Reviewer")
  git(root, "remote", "add", "origin", "https://github.com/acme/example.git")
  await mkdir(join(root, "docs"))
  await writeFile(join(root, "docs", "guide.md"), "old guidance\n")
  await writeFile(join(root, "code.ts"), "export const before = true\n")
  await writeFile(join(root, "password.env"), "SECRET=private\n")
  git(root, "add", ".")
  git(root, "commit", "-qm", "starting point")
  const startCommit = git(root, "rev-parse", "HEAD")
  await writeFile(join(root, "code.ts"), "export const after = true\n")
  git(root, "add", "code.ts")
  git(root, "commit", "-qm", "agent change")
  const agentCommit = git(root, "rev-parse", "HEAD")
  return { root, startCommit, agentCommit }
}

const input = (root: string, startCommit: string): ReviewEvidenceInput => ({
  sessionId: "s1",
  capturedAt: "2026-09-28T00:00:00.000Z",
  origin: {
    cwd: root,
    startCommit,
    repoCandidates: [{ host: "github.com", owner: "acme", repoName: "example", source: "project" }],
  },
  commits: [],
  artifacts: [],
})

describe("stageReviewEvidence", () => {
  test.each([
    { startExcluded: true, afterExcluded: false },
    { startExcluded: false, afterExcluded: true },
    { startExcluded: false, afterExcluded: false },
    { startExcluded: true, afterExcluded: true },
  ])(
    "reports start and after completeness independently (start excluded: $startExcluded, after excluded: $afterExcluded)",
    async ({ startExcluded, afterExcluded }) => {
      const root = await temp()
      git(root, "init", "-q")
      git(root, "config", "user.email", "review@example.test")
      git(root, "config", "user.name", "Reviewer")
      git(root, "remote", "add", "origin", "https://github.com/acme/example.git")
      await writeFile(join(root, "code.ts"), "export const version = 1\n")
      if (startExcluded) await writeFile(join(root, "password.env"), "SECRET=start\n")
      git(root, "add", ".")
      git(root, "commit", "-qm", "starting point")
      const startCommit = git(root, "rev-parse", "HEAD")
      const startState = await captureGitCodeState(root, "start", "s1")

      await writeFile(join(root, "code.ts"), "export const version = 2\n")
      if (startExcluded && !afterExcluded) git(root, "rm", "-q", "password.env")
      if (!startExcluded && afterExcluded)
        await writeFile(join(root, "password.env"), "SECRET=after\n")
      git(root, "add", ".")
      git(root, "commit", "-qm", "agent change")
      const endState = await captureGitCodeState(root, "end", "s1")

      const target = await temp()
      const { manifest } = await stageReviewEvidence(
        { ...input(root, startCommit), startState, endState },
        target,
      )
      expect(manifest.tree.available).toBe(!startExcluded)
      expect(manifest.tree.reason).toBe(startExcluded ? "partial-tree" : undefined)
      expect(manifest.tree.omissions.some((item) => item.path === "password.env")).toBe(
        startExcluded,
      )
      expect(manifest.states?.afterTree?.available).toBe(!afterExcluded)
      expect(
        manifest.states?.afterTree?.omissions.some((item) => item.path === "password.env"),
      ).toBe(afterExcluded)
      expect(
        manifest.omissions.filter((item) => item.path === "password.env").map((item) => item.phase),
      ).toEqual([...(startExcluded ? ["start"] : []), ...(afterExcluded ? ["after"] : [])])
    },
  )

  test("keeps a clean captured tree available and writes its layer manifest", async () => {
    const { root, agentCommit } = await fixture()
    const target = await temp()
    const startState = await captureGitCodeState(root, "start", "s1")
    expect(startState.files).toEqual([])
    const result = await stageReviewEvidence({ ...input(root, agentCommit), startState }, target)
    expect(result.manifest.states?.start?.captureId).toBe(startState.captureId)
    expect(await readFile(join(target, "states", "start.json"), "utf8")).toContain(
      startState.captureId,
    )
  })

  test("reconstructs the captured start and review working trees, including dirty layers", async () => {
    const root = await temp()
    git(root, "init", "-q")
    git(root, "config", "user.email", "review@example.test")
    git(root, "config", "user.name", "Reviewer")
    git(root, "remote", "add", "origin", "https://github.com/acme/example.git")
    await writeFile(join(root, "changed.ts"), "committed\n")
    await writeFile(join(root, "deleted.ts"), "delete me\n")
    await writeFile(join(root, "old-name.ts"), "rename me\n")
    git(root, "add", ".")
    git(root, "commit", "-qm", "baseline")
    const startCommit = git(root, "rev-parse", "HEAD")

    await writeFile(join(root, "changed.ts"), "staged\n")
    git(root, "add", "changed.ts")
    await writeFile(join(root, "changed.ts"), "unstaged at start\n")
    git(root, "rm", "-q", "deleted.ts")
    git(root, "mv", "old-name.ts", "new-name.ts")
    await writeFile(join(root, "untracked.ts"), "already here\n")
    const startState = await captureGitCodeState(root, "start", "s1")

    await writeFile(join(root, "changed.ts"), "agent changed this\n")
    await writeFile(join(root, "created.ts"), "agent created this\n")
    await rm(join(root, "untracked.ts"))
    const reviewState = await captureGitCodeState(root, "review", "s1")

    const target = await temp()
    const result = await stageReviewEvidence(
      { ...input(root, startCommit), startState, reviewState },
      target,
    )
    expect(await readFile(join(target, "tree", "changed.ts"), "utf8")).toBe("unstaged at start\n")
    expect(await readFile(join(target, "tree", "untracked.ts"), "utf8")).toBe("already here\n")
    expect(await readFile(join(target, "tree", "new-name.ts"), "utf8")).toBe("rename me\n")
    await expect(readFile(join(target, "tree", "deleted.ts"))).rejects.toThrow()
    await expect(readFile(join(target, "tree", "old-name.ts"))).rejects.toThrow()
    expect(await readFile(join(target, "after", "tree", "changed.ts"), "utf8")).toBe(
      "agent changed this\n",
    )
    expect(await readFile(join(target, "after", "tree", "created.ts"), "utf8")).toBe(
      "agent created this\n",
    )
    await expect(readFile(join(target, "after", "tree", "untracked.ts"))).rejects.toThrow()
    expect(result.manifest.states?.start?.captureId).toBe(startState.captureId)
    expect(result.manifest.states?.review?.captureId).toBe(reviewState.captureId)
  })

  test("uses a captured session end rather than later checkout changes for the after tree", async () => {
    const { root, agentCommit } = await fixture()
    const startState = await captureGitCodeState(root, "start", "s1")
    await writeFile(join(root, "code.ts"), "last session change\n")
    const endState = await captureGitCodeState(root, "end", "s1")
    await writeFile(join(root, "code.ts"), "later unrelated change\n")
    const reviewState = await captureGitCodeState(root, "review", "s1")
    const target = await temp()
    const result = await stageReviewEvidence(
      { ...input(root, agentCommit), startState, endState, reviewState },
      target,
    )
    expect(await readFile(join(target, "after", "tree", "code.ts"), "utf8")).toBe(
      "last session change\n",
    )
    expect(result.manifest.states?.afterSource).toBe("session-end")
    expect(result.manifest.states?.end?.captureId).toBe(endState.captureId)
  })

  test("stages the start SHA rather than current HEAD and includes labeled session evidence", async () => {
    const { root, startCommit, agentCommit } = await fixture()
    const target = await temp()
    const evidence: ReviewEvidenceInput = {
      ...input(root, startCommit),
      commits: [
        {
          sha: agentCommit,
          repo: { host: "github.com", owner: "acme", repoName: "example" },
          messageId: "m1",
          recordedAt: "2026-09-28T00:01:00.000Z",
        },
      ],
      artifacts: [
        {
          id: "a1",
          path: join(root, "code.ts"),
          relativePath: "code.ts",
          changeKind: "edited",
          isBinary: false,
          baseContent: Buffer.from("export const before = true\n"),
          currentContent: Buffer.from("export const after = true\n"),
          currentHash: hash("export const after = true\n"),
          lastSeenAt: "2026-09-28T00:02:00.000Z",
        },
      ],
    }
    const result = await stageReviewEvidence(evidence, target)
    expect(result.codeDir).toBe(target)
    expect(await readFile(join(target, "tree", "code.ts"), "utf8")).toBe(
      "export const before = true\n",
    )
    expect(await readFile(join(root, "code.ts"), "utf8")).toBe("export const after = true\n")
    expect(await readFile(join(target, "artifacts", "a1", "current"), "utf8")).toBe(
      "export const after = true\n",
    )
    expect(result.manifest.tree.files).toContainEqual(
      expect.objectContaining({ path: "code.ts", sha256: hash("export const before = true\n") }),
    )
    expect(result.manifest.commits).toContainEqual(
      expect.objectContaining({ sha: agentCommit, messageId: "m1" }),
    )
    expect(result.manifest.omissions).toContainEqual(
      expect.objectContaining({ path: "password.env" }),
    )
  })

  test("rejects a different repository at the recorded path and records unavailable context", async () => {
    const { root, startCommit } = await fixture()
    const target = await temp()
    const result = await stageReviewEvidence(
      {
        ...input(root, startCommit),
        origin: {
          ...input(root, startCommit).origin,
          repoCandidates: [
            { host: "local", owner: "/tmp/other", repoName: "repo", source: "project" },
          ],
        },
      },
      target,
    )
    expect(result.manifest.tree.available).toBe(false)
    expect(result.manifest.tree.reason).toBe("repository-identity-mismatch")
    expect(result.codeDir).toBe(target)
  })

  test("does not stage unsafe artifact paths or claim a missing start commit is available", async () => {
    const { root } = await fixture()
    const target = await temp()
    const result = await stageReviewEvidence(
      {
        ...input(root, "f".repeat(40)),
        artifacts: [
          {
            id: "a2",
            path: "/tmp/foreign-file",
            relativePath: "../../foreign-file",
            changeKind: "edited",
            isBinary: false,
            baseContent: null,
            currentContent: Buffer.from("bad"),
            currentHash: hash("bad"),
            lastSeenAt: "2026-09-28T00:02:00.000Z",
          },
        ],
      },
      target,
    )
    expect(result.manifest.tree.available).toBe(false)
    expect(result.manifest.tree.reason).toBe("start-commit-unavailable")
    expect(result.manifest.omissions).toContainEqual(
      expect.objectContaining({ source: "artifact", reason: "unsafe-path" }),
    )
  })

  test("verifies a local repository without a remote and retains artifact citations when its commit is missing", async () => {
    const { root, startCommit } = await fixture()
    git(root, "remote", "remove", "origin")
    const local = {
      host: "local",
      owner: root,
      repoName: root.split("/").at(-1) ?? "",
      source: "project" as const,
    }
    const target = await temp()
    const result = await stageReviewEvidence(
      { ...input(root, startCommit), origin: { cwd: root, startCommit, repoCandidates: [local] } },
      target,
    )
    expect(result.manifest.tree.available).toBe(false) // password.env is intentionally omitted
    expect(result.manifest.repo).toMatchObject({
      host: local.host,
      owner: local.owner,
      repoName: local.repoName,
    })
    expect(await readFile(join(target, "tree", "code.ts"), "utf8")).toContain("before")

    const missingTarget = await temp()
    const missing = await stageReviewEvidence(
      {
        ...input(root, "f".repeat(40)),
        origin: { cwd: root, startCommit: "f".repeat(40), repoCandidates: [local] },
        artifacts: [
          {
            id: "a3",
            path: join(root, "code.ts"),
            relativePath: "code.ts",
            changeKind: "edited",
            isBinary: false,
            baseContent: null,
            currentContent: Buffer.from("valid\n"),
            currentHash: hash("valid\n"),
            lastSeenAt: "2026-09-28T00:02:00.000Z",
          },
        ],
      },
      missingTarget,
    )
    expect(missing.manifest.tree.reason).toBe("start-commit-unavailable")
    expect(missing.manifest.citations).toContainEqual(
      expect.objectContaining({
        repo: `local/${root}/${local.repoName}`,
        kind: "artifact-current",
      }),
    )
  })

  test("uses the recorded checkout and start commit when no repository row was captured", async () => {
    const { root, startCommit } = await fixture()
    const target = await temp()
    const result = await stageReviewEvidence(
      { ...input(root, startCommit), origin: { cwd: root, startCommit, repoCandidates: [] } },
      target,
    )
    expect(await readFile(join(target, "tree", "code.ts"), "utf8")).toBe(
      "export const before = true\n",
    )
    expect(result.manifest.citations).toContainEqual(
      expect.objectContaining({ path: "code.ts", revision: startCommit, kind: "start-tree" }),
    )
    expect(result.manifest.notes).toContainEqual(
      expect.stringContaining("No stored repository identity"),
    )
  })
})
