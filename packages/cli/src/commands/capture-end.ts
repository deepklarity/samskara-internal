import { captureGitCodeState } from "@samskara/core"
import { endCodeStateSpoolDir } from "../config/paths.js"
import { isProjectEnabled } from "../config/projects.js"
import { errorMessage, resolveIo, type Writer } from "../io.js"
import { spoolEndCodeState } from "../watcher/code-state-spool.js"
import { resolveProject } from "../watcher/resolveProject.js"
import type { SessionStartInput } from "./hook-input.js"

export type CaptureEndOptions = {
  readonly hookInput?: SessionStartInput | null
  readonly stderr?: Writer
}

/** SessionEnd is advisory: a failed snapshot never blocks the host session from closing. */
export const captureEndCommand = async (options: CaptureEndOptions = {}): Promise<number> => {
  const { stderr } = resolveIo(options)
  const input = options.hookInput
  if (!input) return 0
  try {
    const project = await resolveProject(input.cwd)
    if (!project || !(await isProjectEnabled(project.slug))) return 0
    const snapshot = await captureGitCodeState(input.cwd, "end", input.sessionId)
    await spoolEndCodeState(endCodeStateSpoolDir(), snapshot, input.reason)
  } catch (error) {
    stderr.write(`samskara end code state: ${errorMessage(error)}\n`)
  }
  return 0
}
