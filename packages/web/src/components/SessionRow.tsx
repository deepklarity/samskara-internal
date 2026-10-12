import { Link } from "react-router-dom"
import { repoLabel } from "../api/repo.js"
import type { SearchSourceKind, SessionSummary } from "../api/types.js"
import { absoluteTime, relativeTime } from "../time.js"

const Unavailable = () => (
  <span className="text-faded italic underline decoration-dotted">unavailable</span>
)

const formatDuration = (ms: number): string => {
  const totalMinutes = Math.round(ms / 60_000)
  if (totalMinutes < 1) return "under a minute"
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

const TOKEN_UNITS = [
  { scale: 1_000_000_000, suffix: "B" },
  { scale: 1_000_000, suffix: "M" },
  { scale: 1_000, suffix: "k" },
] as const

const formatTokens = (total: number): string => {
  const unit = TOKEN_UNITS.find(({ scale }) => total >= scale)
  if (unit === undefined) return `${total} tokens`
  return `${(total / unit.scale).toFixed(1)}${unit.suffix} tokens`
}

/** Compact count without the "tokens" suffix, for the in/out/cached stack. */
export const formatTokenCount = (total: number): string => {
  const unit = TOKEN_UNITS.find(({ scale }) => total >= scale)
  if (unit === undefined) return `${total}`
  return `${(total / unit.scale).toFixed(1)}${unit.suffix}`
}

/**
 * Optional per-direction breakdown. The server list lane currently returns only
 * `tokensTotal`, so every field here is optional and the row falls back to the
 * single total line when the breakdown is absent.
 */
export type SessionTokenBreakdown = {
  readonly tokensInput?: number | null
  readonly tokensOutput?: number | null
  readonly tokensCached?: number | null
  /** Legacy alias shape; the API serializes tokensInput/tokensOutput/tokensCached. */
  readonly inputTokens?: number | null
  readonly outputTokens?: number | null
  readonly cachedTokens?: number | null
}

export type SizeBucket = "Small" | "Medium" | "Large" | "Very large"

export const sizeBucket = (total: number): SizeBucket => {
  if (total < 100_000) return "Small"
  if (total < 1_000_000) return "Medium"
  if (total < 10_000_000) return "Large"
  return "Very large"
}

/** Separate duration pill once a session runs past two hours. */
export const isLongSession = (durationMs: number | null): boolean =>
  durationMs !== null && durationMs > 2 * 60 * 60_000

/** Cached line is worth a row only when it moves the needle. */
export const showCachedTokens = (cached: number, total: number): boolean =>
  cached > 0 && (cached >= 1_000 || (total > 0 && cached / total >= 0.01))

const SOURCE_LABEL: Readonly<Record<SearchSourceKind, string>> = {
  session: "Session",
  message: "Conversation",
  pullRequest: "Pull request",
  toolCall: "Tool call",
  toolResult: "Tool result",
}

type Props = {
  readonly session: SessionSummary
  readonly to: string
  /** Off on a surface that already names the project, where the cell repeats its own heading. */
  readonly showProject?: boolean
}

export const SessionRow = ({ session, to, showProject = true }: Props) => {
  const { title, projectName, userLogin, repo, durationMs, tokensTotal, lastActiveAt } = session
  const match = session.match ?? null
  const breakdown = session as SessionSummary & SessionTokenBreakdown
  const input = breakdown.tokensInput ?? breakdown.inputTokens ?? null
  const output = breakdown.tokensOutput ?? breakdown.outputTokens ?? null
  const cached = breakdown.tokensCached ?? breakdown.cachedTokens ?? 0
  const hasBreakdown = typeof input === "number" || typeof output === "number"
  const showCached = hasBreakdown && showCachedTokens(cached, tokensTotal)
  const bucket = sizeBucket(tokensTotal)

  return (
    <Link
      to={to}
      className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 border border-rule bg-panel-2 px-4 py-2 text-left transition-colors hover:border-ink-soft min-[900px]:grid-cols-[auto_minmax(0,1fr)_minmax(0,14rem)_auto]"
    >
      <span
        aria-hidden="true"
        className="mt-1.5 size-2 shrink-0 rounded-pill border border-custody bg-paper"
      />

      <span className="min-w-0">
        <span className="block truncate text-[0.875rem] font-semibold">
          {title ?? <span className="text-faded italic">untitled session</span>}
          {session.hasAiReview ? (
            <span className="ml-1.5 inline-flex items-center rounded-xs border border-rule px-1.5 py-px align-middle font-mono text-[0.62rem] font-semibold uppercase tracking-[0.06em] text-ink-soft">
              AI review
            </span>
          ) : null}
        </span>
        <span className="block truncate font-mono text-[0.72rem] text-ink-soft">
          {userLogin} · {repo === null ? null : `${repoLabel(repo)} · `}
          {durationMs === null ? <Unavailable /> : formatDuration(durationMs)} ·{" "}
          <span
            title={`size ${bucket} · ${formatTokens(tokensTotal)} total`}
            className="inline-flex items-center rounded-xs border border-rule px-1 py-px font-semibold"
          >
            {bucket}
          </span>
          {isLongSession(durationMs) ? (
            <span
              title={`long session · ${formatDuration(durationMs as number)}`}
              className="ml-1 inline-flex items-center rounded-xs border border-rule px-1 py-px font-semibold"
            >
              Long
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 flex flex-col font-mono text-[0.68rem] leading-4 text-faded">
          {hasBreakdown ? (
            <>
              <span>↑ {formatTokenCount(input ?? 0)} in</span>
              <span>↓ {formatTokenCount(output ?? 0)} out</span>
              {showCached ? <span>↺ {formatTokenCount(cached)} cached</span> : null}
            </>
          ) : (
            <span>{formatTokens(tokensTotal)}</span>
          )}
        </span>
      </span>

      <span className="col-start-2 truncate font-mono text-[0.72rem] text-faded min-[900px]:col-start-3 min-[900px]:self-center">
        {showProject ? projectName : null}
      </span>

      <time
        dateTime={lastActiveAt}
        title={absoluteTime(lastActiveAt)}
        className="col-start-2 font-mono text-[0.72rem] text-ink-soft min-[900px]:col-start-4 min-[900px]:self-center min-[900px]:text-right"
      >
        {relativeTime(lastActiveAt)}
      </time>

      {match === null ? null : (
        <span className="col-start-2 mt-1 block min-w-0 text-[0.78rem] leading-5 text-ink-soft min-[900px]:col-span-3">
          <span className="mr-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-custody">
            {SOURCE_LABEL[match.sourceKind]}
          </span>
          {match.snippet.map((segment) =>
            segment.highlighted ? (
              <mark key={`highlighted:${segment.text}`} className="bg-stamp/20 px-px text-ink">
                {segment.text}
              </mark>
            ) : (
              <span key={`plain:${segment.text}`}>{segment.text}</span>
            ),
          )}
        </span>
      )}
    </Link>
  )
}
