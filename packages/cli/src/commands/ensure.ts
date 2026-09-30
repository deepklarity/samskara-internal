import { captureGitCodeState } from "@samskara/core"
import { readToken } from "../config/credentials.js"
import { reviveWatcher, watcherPid } from "../config/daemon.js"
import { startCodeStateSpoolDir, watchLogDir } from "../config/paths.js"
import { isProjectEnabled } from "../config/projects.js"
import { scopeMismatch, TRIPWIRE_PATHS } from "../config/server-scope.js"
import { errorMessage, resolveIo, type Writer } from "../io.js"
import { checkToken } from "../login.js"
import { readStartCodeState, spoolStartCodeState } from "../watcher/code-state-spool.js"
import { resolveProject } from "../watcher/resolveProject.js"
import type { SessionStartInput } from "./hook-input.js"

export type EnsureOptions = {
  readonly cwd?: string
  readonly stdout?: Writer
  readonly stderr?: Writer
  readonly hookInput?: SessionStartInput | null
}

const emitContext = (stdout: Writer, lines: ReadonlyArray<string>): void => {
  if (lines.length === 0) return
  stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: lines.join("\n"),
      },
    })}\n`,
  )
}

export const ensureCommand = async (options: EnsureOptions = {}): Promise<number> => {
  const { stdout, stderr } = resolveIo(options)
  try {
    const token = await readToken()
    if (!token) {
      emitContext(stdout, [
        "Samskara capture is OFF because the CLI is not authenticated. Tell the user to run `samskara login`.",
      ])
      return 0
    }

    const context: string[] = []
    const [mismatch] = await scopeMismatch(TRIPWIRE_PATHS())
    if (mismatch !== undefined) {
      context.push(
        `Samskara capture is OFF: local state was captured against ${mismatch.recorded}, but the CLI ` +
          `is configured for ${mismatch.current}. Tell the user to run \`samskara init --force\`.`,
      )
    }
    const cwd = options.hookInput?.cwd ?? options.cwd ?? process.cwd()
    const project = await resolveProject(cwd)
    if (project === null || !(await isProjectEnabled(project.slug))) {
      context.push(
        project === null
          ? "This folder could not be identified, so Samskara captures nothing here."
          : `This project (${project.slug}) is not enabled for Samskara capture. Ask the user whether to enable it; if they agree, run \`samskara enable\`.`,
      )
      // A disabled project uploads nothing, so a server round trip would only add startup latency.
      emitContext(stdout, context)
      return 0
    }

    // Capture before the watcher starts and before the agent's first action. Errors are isolated
    // because a code snapshot must never prevent the host session from starting.
    if (
      options.hookInput &&
      mismatch === undefined &&
      ["startup", "clear", "fork"].includes(options.hookInput.source ?? "")
    ) {
      try {
        const dir = startCodeStateSpoolDir()
        if (!(await readStartCodeState(dir, options.hookInput.sessionId))) {
          await spoolStartCodeState(
            dir,
            await captureGitCodeState(cwd, "start", options.hookInput.sessionId),
          )
        }
      } catch (error) {
        stderr.write(`samskara start code state: ${errorMessage(error)}\n`)
      }
    }

    // `watch()` throws on a mismatch, so reviving here would spawn a process guaranteed to die.
    if (mismatch === undefined && watcherPid() === null) {
      await reviveWatcher()
      if (watcherPid() === null) {
        context.push(
          `Samskara capture may be OFF because the watcher did not stay running. Tell the user to check ${watchLogDir()}.`,
        )
      }
    }

    // An enabled project is about to upload, so a token the server no longer accepts is a real
    // outage. An unreachable server is not: the hook fails open rather than crying wolf.
    if ((await checkToken(token)) === "rejected") {
      context.push(
        `Samskara capture is OFF for this project (${project.slug}) because the server rejected the stored credentials. Tell the user to run \`samskara login\` to pair again.`,
      )
    }
    emitContext(stdout, context)
  } catch (error) {
    stderr.write(`samskara ensure: ${errorMessage(error)}\n`)
  }
  return 0
}
