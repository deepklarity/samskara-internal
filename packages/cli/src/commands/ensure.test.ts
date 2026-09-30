import type { ProjectIdentity } from "@samskara/core"
import { captureGitCodeState } from "@samskara/core"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { readToken } from "../config/credentials.js"
import { reviveWatcher, watcherPid } from "../config/daemon.js"
import { isProjectEnabled } from "../config/projects.js"
import { scopeMismatch } from "../config/server-scope.js"
import { checkToken } from "../login.js"
import { readStartCodeState, spoolStartCodeState } from "../watcher/code-state-spool.js"
import { resolveProject } from "../watcher/resolveProject.js"
import { ensureCommand } from "./ensure.js"

vi.mock("../config/credentials.js", () => ({ readToken: vi.fn() }))
vi.mock("../config/daemon.js", () => ({ reviveWatcher: vi.fn(), watcherPid: vi.fn() }))
vi.mock("../config/projects.js", () => ({ isProjectEnabled: vi.fn() }))
vi.mock("../config/server-scope.js", () => ({
  scopeMismatch: vi.fn(),
  TRIPWIRE_PATHS: vi.fn(() => []),
}))
vi.mock("../watcher/resolveProject.js", () => ({ resolveProject: vi.fn() }))
vi.mock("../login.js", () => ({ checkToken: vi.fn() }))
vi.mock("@samskara/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  captureGitCodeState: vi.fn(),
}))
vi.mock("../watcher/code-state-spool.js", () => ({
  readStartCodeState: vi.fn(),
  spoolStartCodeState: vi.fn(),
}))

const project: ProjectIdentity = { name: "widget", slug: "acme-widget" }

const output = () => {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    writers: {
      stdout: { write: (text: string) => stdout.push(text) },
      stderr: { write: (text: string) => stderr.push(text) },
    },
  }
}

beforeEach(() => {
  vi.mocked(readToken).mockResolvedValue("token")
  vi.mocked(watcherPid).mockReturnValue(321)
  vi.mocked(reviveWatcher).mockResolvedValue(321)
  vi.mocked(resolveProject).mockResolvedValue(project)
  vi.mocked(isProjectEnabled).mockResolvedValue(true)
  vi.mocked(checkToken).mockResolvedValue("ok")
  vi.mocked(scopeMismatch).mockResolvedValue([])
  vi.mocked(captureGitCodeState).mockResolvedValue({ sessionId: "s1", phase: "start" } as never)
  vi.mocked(spoolStartCodeState).mockResolvedValue()
  vi.mocked(readStartCodeState).mockResolvedValue(null)
})

describe("ensure command", () => {
  test("captures the hook cwd and session id before reviving the watcher", async () => {
    vi.mocked(watcherPid).mockReturnValueOnce(null).mockReturnValue(321)
    await ensureCommand({
      hookInput: { sessionId: "s1", cwd: "/work/hook", source: "startup" },
      ...output().writers,
    })
    expect(resolveProject).toHaveBeenCalledWith("/work/hook")
    expect(captureGitCodeState).toHaveBeenCalledWith("/work/hook", "start", "s1")
    expect(spoolStartCodeState).toHaveBeenCalledOnce()
    expect(vi.mocked(spoolStartCodeState).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(reviveWatcher).mock.invocationCallOrder[0] as number,
    )
  })

  test("a code capture failure leaves SessionStart successful", async () => {
    vi.mocked(captureGitCodeState).mockRejectedValueOnce(new Error("cannot read index"))
    const streams = output()
    expect(
      await ensureCommand({
        hookInput: { sessionId: "s1", cwd: "/repo", source: "startup" },
        ...streams.writers,
      }),
    ).toBe(0)
    expect(streams.stderr.join("")).toContain("cannot read index")
  })

  test("a resumed hook does not recapture and replace its first snapshot", async () => {
    expect(
      await ensureCommand({ hookInput: { sessionId: "s1", cwd: "/repo", source: "resume" } }),
    ).toBe(0)
    expect(captureGitCodeState).not.toHaveBeenCalled()
    expect(spoolStartCodeState).not.toHaveBeenCalled()
  })
  test("REQ-021: missing credentials emit login guidance without starting a watcher", async () => {
    const streams = output()
    vi.mocked(readToken).mockResolvedValue(null)

    const code = await ensureCommand(streams.writers)

    expect(code).toBe(0)
    expect(reviveWatcher).not.toHaveBeenCalled()
    expect(streams.stdout.join("")).toContain('"hookEventName":"SessionStart"')
    expect(streams.stdout.join("")).toContain("samskara login")
  })

  test("REQ-022: authenticated ensure revives a dead watcher", async () => {
    const streams = output()
    vi.mocked(watcherPid).mockReturnValueOnce(null).mockReturnValue(321)

    const code = await ensureCommand(streams.writers)

    expect(code).toBe(0)
    expect(reviveWatcher).toHaveBeenCalled()
    expect(streams.stdout).toEqual([])
  })

  test("REQ-023,EDGE-008: immediate daemon death emits fail-open capture guidance", async () => {
    const streams = output()
    vi.mocked(watcherPid).mockReturnValue(null)

    const code = await ensureCommand(streams.writers)

    expect(code).toBe(0)
    expect(streams.stdout.join("")).toContain("capture may be OFF")
    expect(streams.stdout.join("")).toContain("logs")
  })

  test("REQ-024: inactive current folder emits enable guidance", async () => {
    const streams = output()
    vi.mocked(isProjectEnabled).mockResolvedValue(false)

    const code = await ensureCommand({ cwd: "/work/widget", ...streams.writers })

    expect(code).toBe(0)
    expect(streams.stdout.join("")).toContain("acme-widget")
    expect(streams.stdout.join("")).toContain("samskara enable")
  })

  test("REQ-026: an enabled project whose stored token the server rejects warns to log in again", async () => {
    const streams = output()
    vi.mocked(checkToken).mockResolvedValue("rejected")

    const code = await ensureCommand(streams.writers)

    expect(code).toBe(0)
    expect(checkToken).toHaveBeenCalledWith("token")
    expect(streams.stdout.join("")).toContain("samskara login")
    expect(streams.stdout.join("")).toContain("acme-widget")
  })

  test("REQ-026b: an enabled project with an accepted token stays silent", async () => {
    const streams = output()

    const code = await ensureCommand(streams.writers)

    expect(code).toBe(0)
    expect(streams.stdout).toEqual([])
  })

  test("REQ-026c: an unreachable server is not reported as a rejected login", async () => {
    const streams = output()
    vi.mocked(checkToken).mockResolvedValue("unreachable")

    const code = await ensureCommand(streams.writers)

    expect(code).toBe(0)
    expect(streams.stdout.join("")).not.toContain("samskara login")
  })

  test("REQ-026d: a disabled project is not checked against the server at all", async () => {
    const streams = output()
    vi.mocked(isProjectEnabled).mockResolvedValue(false)

    await ensureCommand(streams.writers)

    expect(checkToken).not.toHaveBeenCalled()
  })

  test("REQ-025: unexpected failures never block SessionStart", async () => {
    const streams = output()
    vi.mocked(readToken).mockRejectedValue(new Error("disk unavailable"))

    const code = await ensureCommand(streams.writers)

    expect(code).toBe(0)
    expect(streams.stderr.join("")).toContain("disk unavailable")
  })

  test("SC24: a mismatched projects.json is reported as SessionStart context", async () => {
    const streams = output()
    vi.mocked(scopeMismatch).mockResolvedValue([
      { file: "/x/projects.json", recorded: "https://one.example", current: "https://two.example" },
    ])

    const code = await ensureCommand(streams.writers)

    expect(code).toBe(0)
    expect(streams.stdout.join("")).toContain("https://one.example")
    expect(streams.stdout.join("")).toContain("https://two.example")
    expect(streams.stdout.join("")).toContain("samskara init --force")
  })

  // `watch()` throws on a mismatch, so reviving spawns a process guaranteed to die -- once per
  // session start.
  test("SC28: a mismatch does not spawn a watcher that is guaranteed to die", async () => {
    vi.mocked(watcherPid).mockReturnValue(null)
    vi.mocked(scopeMismatch).mockResolvedValue([
      { file: "/x/projects.json", recorded: "https://one.example", current: "https://two.example" },
    ])
    const streams = output()

    const code = await ensureCommand(streams.writers)

    expect(code).toBe(0)
    expect(reviveWatcher).not.toHaveBeenCalled()
    expect(streams.stdout.join("")).toContain("samskara init --force")
    expect(streams.stdout.join("")).not.toContain("did not stay running")
  })
})
