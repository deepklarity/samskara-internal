import type { Readable } from "node:stream"

export type SessionStartInput = {
  readonly sessionId: string
  readonly cwd: string
  readonly source?: string
  readonly reason?: string
}

/** Claude closes hook stdin after its JSON event. Never hold SessionStart open indefinitely. */
export const readSessionStartInput = (
  stdin: Readable,
  timeoutMs = 500,
): Promise<SessionStartInput | null> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = []
    let bytes = 0
    const finish = (value: SessionStartInput | null) => {
      clearTimeout(timer)
      stdin.off("data", onData)
      stdin.off("end", onEnd)
      stdin.off("error", onError)
      stdin.pause()
      resolve(value)
    }
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > 64 * 1024) return finish(null)
      chunks.push(buffer)
    }
    const onEnd = () => {
      try {
        const raw: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        if (typeof raw !== "object" || raw === null) return finish(null)
        const data = raw as Record<string, unknown>
        if (typeof data.session_id !== "string" || typeof data.cwd !== "string") return finish(null)
        if (!data.session_id || !data.cwd || data.session_id.length > 200) return finish(null)
        finish({
          sessionId: data.session_id,
          cwd: data.cwd,
          ...(typeof data.source === "string" ? { source: data.source } : {}),
          ...(typeof data.reason === "string" ? { reason: data.reason.slice(0, 200) } : {}),
        })
      } catch {
        finish(null)
      }
    }
    const onError = () => finish(null)
    const timer = setTimeout(() => finish(null), timeoutMs)
    stdin.on("data", onData)
    stdin.once("end", onEnd)
    stdin.once("error", onError)
    stdin.resume()
  })

export const readSessionEndInput = readSessionStartInput
