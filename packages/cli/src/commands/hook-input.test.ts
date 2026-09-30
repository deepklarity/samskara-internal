import { Readable } from "node:stream"
import { expect, test } from "vitest"
import { readSessionStartInput } from "./hook-input.js"

test("reads the Claude SessionStart session id and cwd", async () => {
  expect(
    await readSessionStartInput(
      Readable.from([JSON.stringify({ session_id: "s1", cwd: "/repo", source: "startup" })]),
    ),
  ).toEqual({ sessionId: "s1", cwd: "/repo", source: "startup" })
})

test("preserves SessionEnd reason as bounded local provenance", async () => {
  expect(
    await readSessionStartInput(
      Readable.from([JSON.stringify({ session_id: "s1", cwd: "/repo", reason: "x".repeat(300) })]),
    ),
  ).toEqual({ sessionId: "s1", cwd: "/repo", reason: "x".repeat(200) })
})

test("malformed or oversized hook input fails open", async () => {
  expect(await readSessionStartInput(Readable.from(["{"]))).toBeNull()
  expect(await readSessionStartInput(Readable.from(["x".repeat(65 * 1024)]))).toBeNull()
})
