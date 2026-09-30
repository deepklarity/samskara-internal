import { captureGitCodeState } from "@samskara/core"
import { beforeEach, expect, test, vi } from "vitest"
import { isProjectEnabled } from "../config/projects.js"
import { spoolEndCodeState } from "../watcher/code-state-spool.js"
import { resolveProject } from "../watcher/resolveProject.js"
import { captureEndCommand } from "./capture-end.js"

vi.mock("@samskara/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  captureGitCodeState: vi.fn(),
}))
vi.mock("../config/projects.js", () => ({ isProjectEnabled: vi.fn() }))
vi.mock("../watcher/resolveProject.js", () => ({ resolveProject: vi.fn() }))
vi.mock("../watcher/code-state-spool.js", () => ({ spoolEndCodeState: vi.fn() }))

beforeEach(() => {
  vi.mocked(resolveProject).mockResolvedValue({ name: "app", slug: "org-app" })
  vi.mocked(isProjectEnabled).mockResolvedValue(true)
  vi.mocked(captureGitCodeState).mockResolvedValue({ phase: "end", captureId: "id" } as never)
  vi.mocked(spoolEndCodeState).mockResolvedValue()
})

test("SessionEnd captures and spools the end state with hook reason", async () => {
  expect(
    await captureEndCommand({ hookInput: { sessionId: "s1", cwd: "/repo", reason: "logout" } }),
  ).toBe(0)
  expect(captureGitCodeState).toHaveBeenCalledWith("/repo", "end", "s1")
  expect(spoolEndCodeState).toHaveBeenCalledWith(
    expect.any(String),
    { phase: "end", captureId: "id" },
    "logout",
  )
})

test("SessionEnd capture failures never block session exit", async () => {
  vi.mocked(captureGitCodeState).mockRejectedValueOnce(new Error("Git busy"))
  const stderr: string[] = []
  expect(
    await captureEndCommand({
      hookInput: { sessionId: "s1", cwd: "/repo" },
      stderr: { write: (text) => stderr.push(text) },
    }),
  ).toBe(0)
  expect(stderr.join("")).toContain("Git busy")
})
