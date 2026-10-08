import type { AiTimelineEntry, RawMessage, RawToolCall } from "../api/types.js"

export type TimelineTone = "good" | "failure" | "slow"

/**
 * seq numbers in review entries are export line numbers, so a message id resolves
 * to its seq through the captured messages' lineNumber.
 */
export const failedSeqsOf = (
  messages: ReadonlyArray<Pick<RawMessage, "id" | "lineNumber">>,
  toolCalls: ReadonlyArray<Pick<RawToolCall, "messageId" | "status">>,
): ReadonlySet<number> => {
  const lineOf = new Map(messages.map((message) => [message.id, message.lineNumber]))
  const failed = new Set<number>()
  for (const call of toolCalls) {
    const status = (call.status ?? "").toLowerCase()
    if (status !== "failed" && status !== "failure" && status !== "error") continue
    const line = lineOf.get(call.messageId)
    if (line !== undefined) failed.add(line)
  }
  return failed
}

const SLOW_SHARE = 0.25
const SLOW_FLOOR_MS = 60_000

/**
 * Read-only derivation from data the page already holds: a tool result with a
 * failed/error status inside the entry's seq range marks a tool failure (wins over
 * slow); otherwise a large duration share of the session marks the slow path;
 * everything else is a clean stretch. Empty ranges and missing timestamps can
 * never read as slow. A turning point keeps its accent color instead of reading
 * slow — the moment things turned is the story, not the time it took.
 */
export const timelineTone = (
  entry: Pick<AiTimelineEntry, "fromSeq" | "toSeq" | "durationMs"> & {
    readonly kind?: AiTimelineEntry["kind"]
  },
  failedSeqs: ReadonlySet<number>,
  totalMs: number,
): TimelineTone => {
  if (entry.fromSeq <= entry.toSeq) {
    for (let seq = entry.fromSeq; seq <= entry.toSeq; seq += 1) {
      if (failedSeqs.has(seq)) return "failure"
    }
  }
  const duration = entry.durationMs ?? 0
  if (
    duration > 0 &&
    totalMs > 0 &&
    entry.kind !== "turning-point" &&
    duration >= Math.max(SLOW_FLOOR_MS, totalMs * SLOW_SHARE)
  ) {
    return "slow"
  }
  return "good"
}
