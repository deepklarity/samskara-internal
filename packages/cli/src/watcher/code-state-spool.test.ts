import { createHash } from "node:crypto"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CodeStateSnapshot } from "@samskara/core"
import { afterEach, expect, test, vi } from "vitest"
import {
  drainEndCodeStates,
  drainStartCodeStates,
  spoolEndCodeState,
  spoolStartCodeState,
} from "./code-state-spool.js"

const root = await mkdtemp(join(tmpdir(), "samskara-code-spool-test-"))
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const snapshot = (content: string): CodeStateSnapshot => ({
  version: 1,
  phase: "start",
  sessionId: "../../session-1",
  captureId: "00000000-0000-4000-8000-000000000001",
  capturedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:00:01.000Z",
  cwd: "/repo",
  repoRoot: "/repo",
  headSha: "a".repeat(40),
  complete: true,
  files: [
    {
      path: "a.ts",
      layer: "worktree",
      kind: "file",
      contentBase64: Buffer.from(content).toString("base64"),
      sha256: createHash("sha256").update(content).digest("hex"),
    },
  ],
  omissions: [],
})

test("spool uses a safe name and preserves the first snapshot", async () => {
  const dir = join(root, "one")
  await spoolStartCodeState(dir, snapshot("first"))
  await spoolStartCodeState(dir, snapshot("second"))
  const names = await readdir(dir)
  expect(names).toHaveLength(1)
  expect(names[0]).toMatch(/^[0-9a-f]{64}\.json$/)
  const saved = JSON.parse(
    await readFile(join(dir, names[0] as string), "utf8"),
  ) as CodeStateSnapshot
  expect(Buffer.from(saved.files[0]?.contentBase64 ?? "", "base64").toString()).toBe("first")
})

test("drain retries failed uploads and deletes only after accepted upload", async () => {
  const dir = join(root, "two")
  await spoolStartCodeState(dir, snapshot("first"))
  const send = vi.fn().mockResolvedValueOnce({ status: 409 }).mockResolvedValueOnce({ status: 201 })
  const log = { warn: vi.fn(), debug: vi.fn() } as never
  await drainStartCodeStates(dir, { send }, log)
  expect(await readdir(dir)).toHaveLength(1)
  await drainStartCodeStates(dir, { send }, log)
  expect(await readdir(dir)).toHaveLength(0)
  expect(send).toHaveBeenCalledTimes(2)
})

test("separate SessionEnd events for a resumed session remain separately uploadable", async () => {
  const dir = join(root, "end")
  const first: CodeStateSnapshot = { ...snapshot("one"), phase: "end" }
  const second: CodeStateSnapshot = {
    ...snapshot("two"),
    phase: "end",
    captureId: "00000000-0000-4000-8000-000000000002",
  }
  await spoolEndCodeState(dir, first, "logout")
  await spoolEndCodeState(dir, second, "resume-switch")
  expect(await readdir(dir)).toHaveLength(2)
  const send = vi.fn().mockResolvedValue({ status: 201 })
  await drainEndCodeStates(dir, { send }, { warn: vi.fn(), debug: vi.fn() } as never)
  expect(send.mock.calls.map(([payload]) => payload.captureId).sort()).toEqual([
    first.captureId,
    second.captureId,
  ])
  expect(await readdir(dir)).toHaveLength(0)
})
