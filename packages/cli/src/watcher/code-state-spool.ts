import { createHash, randomUUID } from "node:crypto"
import { link, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { type CodeStateSnapshot, codeStateSnapshotSchema } from "@samskara/core"
import type pino from "pino"
import type { SinkResult } from "./sink.js"

const fileNameFor = (sessionId: string): string =>
  `${createHash("sha256").update(sessionId).digest("hex")}.json`

const endFileNameFor = (sessionId: string, captureId: string): string =>
  `${createHash("sha256").update(sessionId).digest("hex")}.${captureId}.json`

export const readStartCodeState = async (
  dir: string,
  sessionId: string,
): Promise<CodeStateSnapshot | null> => {
  try {
    const parsed = codeStateSnapshotSchema.parse(
      JSON.parse(await readFile(join(dir, fileNameFor(sessionId)), "utf8")),
    )
    return parsed.phase === "start" && parsed.sessionId === sessionId ? parsed : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

/** First observed hook state wins. The temporary file makes an interrupted write invisible. */
export const spoolStartCodeState = async (
  dir: string,
  snapshot: CodeStateSnapshot,
): Promise<void> => {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const target = join(dir, fileNameFor(snapshot.sessionId))
  const temporary = join(dir, `${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(snapshot), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  })
  try {
    await link(temporary, target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error
    })
  } finally {
    await unlink(temporary)
  }
}

/** SessionEnd can fire again after resume. Preserve every distinct end capture. */
export const spoolEndCodeState = async (
  dir: string,
  snapshot: CodeStateSnapshot,
  reason?: string,
): Promise<void> => {
  if (snapshot.phase !== "end") throw new Error("expected an end code state")
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const target = join(dir, endFileNameFor(snapshot.sessionId, snapshot.captureId))
  const temporary = join(dir, `${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify({ snapshot, ...(reason ? { reason } : {}) }), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  })
  try {
    await link(temporary, target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error
    })
  } finally {
    await unlink(temporary)
  }
}

export const drainStartCodeStates = async (
  dir: string,
  sink: { send(payload: CodeStateSnapshot): Promise<SinkResult> },
  log: Pick<pino.Logger, "warn" | "debug">,
): Promise<void> => {
  const names = await readdir(dir).catch((error: NodeJS.ErrnoException): string[] => {
    if (error.code === "ENOENT") return []
    throw error
  })
  for (const name of names) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) continue
    const path = join(dir, name)
    try {
      const parsed = codeStateSnapshotSchema.parse(JSON.parse(await readFile(path, "utf8")))
      if (parsed.phase !== "start" || fileNameFor(parsed.sessionId) !== name) {
        throw new Error("spool identity mismatch")
      }
      const result = await sink.send(parsed)
      if (result.status >= 200 && result.status < 300) {
        await unlink(path)
        log.debug(
          { sessionId: parsed.sessionId, captureId: parsed.captureId },
          "start code state uploaded",
        )
      } else {
        log.warn(
          { sessionId: parsed.sessionId, status: result.status, detail: result.detail },
          "start code state upload will retry",
        )
      }
    } catch (error) {
      log.warn({ path, err: error }, "start code state spool entry could not be uploaded")
    }
  }
}

export const drainEndCodeStates = async (
  dir: string,
  sink: { send(payload: CodeStateSnapshot): Promise<SinkResult> },
  log: Pick<pino.Logger, "warn" | "debug">,
): Promise<void> => {
  const names = await readdir(dir).catch((error: NodeJS.ErrnoException): string[] => {
    if (error.code === "ENOENT") return []
    throw error
  })
  for (const name of names) {
    if (!/^[0-9a-f]{64}\.[0-9a-f-]{36}\.json$/.test(name)) continue
    const path = join(dir, name)
    try {
      const envelope: unknown = JSON.parse(await readFile(path, "utf8"))
      if (typeof envelope !== "object" || envelope === null || !("snapshot" in envelope)) {
        throw new Error("invalid end code state spool entry")
      }
      const parsed = codeStateSnapshotSchema.parse(envelope.snapshot)
      if (parsed.phase !== "end" || endFileNameFor(parsed.sessionId, parsed.captureId) !== name) {
        throw new Error("end spool identity mismatch")
      }
      const result = await sink.send(parsed)
      if (result.status >= 200 && result.status < 300) {
        await unlink(path)
        log.debug(
          { sessionId: parsed.sessionId, captureId: parsed.captureId },
          "end code state uploaded",
        )
      } else {
        log.warn(
          { sessionId: parsed.sessionId, status: result.status, detail: result.detail },
          "end code state upload will retry",
        )
      }
    } catch (error) {
      log.warn({ path, err: error }, "end code state spool entry could not be uploaded")
    }
  }
}
