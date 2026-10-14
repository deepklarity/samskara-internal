import { Link } from "react-router-dom"
import { repoLabel } from "../api/repo.js"
import type { SearchSourceKind, SessionSummary } from "../api/types.js"
import { absoluteTime, relativeTime } from "../time.js"
import { Badge } from "./ui/badge.js"
import { Card, CardContent } from "./ui/card.js"

const Unavailable = () => (
  <span className="text-muted-foreground italic underline decoration-dotted">unavailable</span>
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

export const formatTokenCount = (total: number): string => {
  const unit = TOKEN_UNITS.find(({ scale }) => total >= scale)
  if (unit === undefined) return `${total}`
  return `${(total / unit.scale).toFixed(1)}${unit.suffix}`
}

export type SessionTokenBreakdown = {
  readonly tokensInput?: number | null
  readonly tokensOutput?: number | null
  readonly tokensCached?: number | null
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

export const isLongSession = (durationMs: number | null): boolean =>
  durationMs !== null && durationMs > 2 * 60 * 60_000

export const showCachedTokens = (cached: number, total: number): boolean =>
  cached > 0 && (cached >= 1_000 || (total > 0 && cached / total >= 0.01))

const SOURCE_LABEL: Readonly<Record<SearchSourceKind, string>> = {
  session: "Session",
  message: "Conversation",
  pullRequest: "Pull request",
  toolCall: "Tool call",
  toolResult: "Tool result",
}

const statusColors: Readonly<Record<string, string>> = {
  complete: "bg-emerald-500",
  running: "bg-blue-500",
  pending: "bg-amber-500",
  failed: "bg-red-500",
  cancelled: "bg-muted-foreground",
}

type Props = {
  readonly session: SessionSummary
  readonly to: string
  readonly showProject?: boolean
}

export const SessionRow = ({ session, to, showProject = true }: Props) => {
  const { title, projectName, userLogin, repo, durationMs, tokensTotal, lastActiveAt, status } =
    session
  const match = session.match ?? null
  const breakdown = session as SessionSummary & SessionTokenBreakdown
  const input = breakdown.tokensInput ?? breakdown.inputTokens ?? null
  const output = breakdown.tokensOutput ?? breakdown.outputTokens ?? null
  const cached = breakdown.tokensCached ?? breakdown.cachedTokens ?? 0
  const hasBreakdown = typeof input === "number" || typeof output === "number"
  const showCached = hasBreakdown && showCachedTokens(cached, tokensTotal)
  const bucket = sizeBucket(tokensTotal)
  const statusColor = statusColors[status] ?? "bg-muted-foreground"

  return (
    <Link to={to} className="w-full transition-colors hover:bg-accent/50">
      <Card className="border border-border bg-card hover:border-border/50">
        <CardContent className="p-3">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 min-[900px]:grid-cols-[auto_minmax(0,1fr)_minmax(0,14rem)_auto]">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${statusColor}`} />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-medium text-sm text-foreground">
                    {title ?? (
                      <span className="text-muted-foreground italic">untitled session</span>
                    )}
                  </span>
                  {session.hasAiReview ? (
                    <Badge
                      variant="outline"
                      className="px-2 py-0.5 text-xs font-mono uppercase tracking-[0.06em]"
                    >
                      AI review
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{userLogin}</span>
                  <span aria-hidden="true"> · </span>
                  {repo !== null && (
                    <>
                      <span>{repoLabel(repo)}</span>
                      <span aria-hidden="true"> · </span>
                    </>
                  )}
                  {durationMs === null ? (
                    <Unavailable />
                  ) : (
                    <span>{formatDuration(durationMs)}</span>
                  )}
                  <span aria-hidden="true"> · </span>
                  <Badge
                    variant="default"
                    title={
                      isLongSession(durationMs)
                        ? `long session · size ${bucket} · ${formatTokens(tokensTotal)} total`
                        : `size ${bucket} · ${formatTokens(tokensTotal)} total`
                    }
                    className="gap-1 px-2 py-0.5 font-sans not-italic"
                  >
                    {isLongSession(durationMs) ? (
                      <>
                        <span className="font-medium">Long</span>
                        <span aria-hidden="true"> · </span>
                        <span>{bucket}</span>
                      </>
                    ) : (
                      bucket
                    )}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-col font-mono text-[0.68rem] leading-4 text-muted-foreground">
                  {hasBreakdown ? (
                    <>
                      <span>↑ {formatTokenCount(input ?? 0)} in</span>
                      <span>↓ {formatTokenCount(output ?? 0)} out</span>
                      {showCached ? <span>↺ {formatTokenCount(cached)} cached</span> : null}
                    </>
                  ) : (
                    <span>{formatTokens(tokensTotal)}</span>
                  )}
                </div>
              </div>
            </div>

            {showProject ? (
              <div className="hidden truncate font-mono text-xs text-muted-foreground min-[900px]:block min-[900px]:self-center">
                {projectName}
              </div>
            ) : null}

            <time
              dateTime={lastActiveAt}
              title={absoluteTime(lastActiveAt)}
              className="hidden font-mono text-xs text-muted-foreground min-[900px]:block min-[900px]:self-center min-[900px]:text-right"
            >
              {relativeTime(lastActiveAt)}
            </time>
          </div>

          {match !== null && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-baseline gap-2 text-sm text-muted-foreground">
                <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.1em]">
                  {SOURCE_LABEL[match.sourceKind]}
                </span>
                {match.snippet.map((segment) =>
                  segment.highlighted ? (
                    <mark
                      key={`highlighted:${segment.text}`}
                      className="bg-accent px-0.5 text-foreground"
                    >
                      {segment.text}
                    </mark>
                  ) : (
                    <span key={`plain:${segment.text}`}>{segment.text}</span>
                  ),
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
