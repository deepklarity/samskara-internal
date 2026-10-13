import type { NormalizedMessage } from "../ingest/types.js"

export const REVIEW_OUTCOMES = ["shipped", "productive", "struggled", "aborted"] as const
export const REVIEW_FRICTIONS = ["none", "moderate", "high"] as const
export const LEARNING_AUDIENCES = ["agent", "human"] as const
export const LEARNING_STATUSES = ["candidate", "accepted", "superseded"] as const

export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number]
export type ReviewFriction = (typeof REVIEW_FRICTIONS)[number]
export type LearningAudience = (typeof LEARNING_AUDIENCES)[number]
export type LearningStatus = (typeof LEARNING_STATUSES)[number]

/**
 * The neutral event vocabulary a review consumes, before sequencing. Small on purpose: the
 * server projects its split tables (messages, toolCall, toolResult, tokenUsage) into this
 * stream with a trivial mapper, and core projects a normalized ingest payload with
 * `reviewEventsFromMessages` — one analyzer, two producers, no drift between what the CLI
 * captured and what the server stored.
 *
 * `toolResult` carries no name of its own: the transcript names the tool only on the call
 * side, so producers join by callId (the adapter below does it; the server's mapper joins its
 * toolCall rows).
 */
export type ReviewEventBody =
  | { readonly kind: "turn"; readonly status: "completed" | "aborted" }
  | { readonly kind: "userMessage"; readonly text: string; readonly isMeta: boolean }
  | { readonly kind: "assistantMessage" }
  | { readonly kind: "toolCall"; readonly callId: string; readonly name: string }
  | {
      readonly kind: "toolResult"
      readonly callId: string
      readonly name: string | null
      readonly status: "success" | "failure" | "cancelled" | "unknown"
    }
  | { readonly kind: "edit"; readonly path: string }
  | { readonly kind: "compaction" }
  | { readonly kind: "commit"; readonly sha: string }
  | { readonly kind: "pullRequest"; readonly number: number }
  | {
      readonly kind: "tokens"
      readonly input: number
      readonly output: number
      readonly cached: number
      readonly thinking: number
    }

export type ReviewEvent = ReviewEventBody & { readonly seq: number }

export const sequenceEvents = (bodies: ReadonlyArray<ReviewEventBody>): ReviewEvent[] =>
  bodies.map((body, index) => ({ ...body, seq: index }))

const EDIT_TOOL_NAMES = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"])

/**
 * Projects a normalized ingest message list into review events. Only structure survives:
 * text is kept for user messages (correction detection reads arrival timing, not wording)
 * and dropped everywhere else, so a review never depends on prose it cannot verify.
 */
export const reviewEventsFromMessages = (
  messages: ReadonlyArray<NormalizedMessage>,
): ReviewEvent[] => {
  const bodies: ReviewEventBody[] = []
  const toolNameByCallId = new Map<string, string>()
  for (const message of messages) {
    switch (message.msgType) {
      case "message":
        if (message.role === "user") {
          // Stored rows carry null where normalized messages carry undefined, so absent means
          // both. isMeta from details wins; a non-empty subType marks a harness injection.
          const isMeta =
            (message.details?.isMeta ?? (message.subType ?? null) !== null) ||
            (message.trackId ?? "main") !== "main"
          const text =
            message.content.type === "text"
              ? message.content.value
              : message.content.type === "reasoning"
                ? (message.content.value ?? "")
                : ""
          bodies.push({ kind: "userMessage", text, isMeta })
        } else if (message.role === "assistant") {
          bodies.push({ kind: "assistantMessage" })
        }
        break
      case "toolCall": {
        bodies.push({
          kind: "toolCall",
          callId: message.details.callId,
          name: message.details.name,
        })
        toolNameByCallId.set(message.details.callId, message.details.name)
        const path = (message.details.input as { file_path?: string; filePath?: string } | null)
          ?.file_path
        if (EDIT_TOOL_NAMES.has(message.details.name) && typeof path === "string" && path !== "") {
          bodies.push({ kind: "edit", path })
        }
        break
      }
      case "toolResult":
        bodies.push({
          kind: "toolResult",
          callId: message.details.callId,
          name: toolNameByCallId.get(message.details.callId) ?? null,
          status: message.details.status,
        })
        break
      case "turnEvent":
        bodies.push({
          kind: "turn",
          status: message.details.status === "aborted" ? "aborted" : "completed",
        })
        break
      case "compaction":
        bodies.push({ kind: "compaction" })
        break
      case "usage":
        if (message.details.type === "tokens") {
          bodies.push({ kind: "tokens", ...message.details.tokens })
        }
        break
    }
    // Usage-type lines report tokens in `details` (handled above); every other line reports
    // them in the optional `tokens` field of the token-owner shape. A line is one or the
    // other, so pushing both ways never double counts.
    if (message.msgType !== "usage" && message.tokens !== undefined) {
      bodies.push({ kind: "tokens", ...message.tokens })
    }
  }
  return sequenceEvents(bodies)
}

/**
 * Strip the machine-specific prefix from an absolute edit path so two people editing the
 * same file on different checkouts produce the same fingerprint. Home-directory segments
 * (`/Users/alice`, `/home/bob`) are dropped along with everything above the repo root; a
 * path we cannot anchor becomes its last two segments, which still keeps the file name and
 * its immediate parent while never carrying a username.
 */
export const safeEditPath = (path: string): string => {
  const segments = path.split("/").filter((segment) => segment !== "")
  const home = segments.findIndex((segment) => segment === "Users" || segment === "home")
  // Skip past the account segment that follows a home root: /Users/alice and /home/bob.
  const from = home === -1 ? 0 : home + 2
  const tail = segments.slice(Math.max(from, segments.length - 2))
  return tail.length === 0 ? path : tail.join("/")
}

/**
 * Rewrite edit-event paths through a capture-supplied mapping first (the authoritative
 * repo-relative path recorded with the session), falling back to {@link safeEditPath}.
 * Non-edit events pass through untouched.
 */
export const relativizeEditEvents = <T extends { readonly kind: string; readonly path?: string }>(
  events: ReadonlyArray<T>,
  repoRelative: ReadonlyMap<string, string>,
): ReadonlyArray<T> =>
  events.map((event) =>
    event.kind === "edit" && event.path !== undefined
      ? ({ ...event, path: repoRelative.get(event.path) ?? safeEditPath(event.path) } as T)
      : event,
  )
