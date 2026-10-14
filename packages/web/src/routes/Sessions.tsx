import { X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { type ApiError, client, request } from "../api/client.js"
import type { FilterOption, SessionListPayload } from "../api/types.js"
import { SessionExpired } from "../auth/SessionExpired.js"
import { optionFor } from "../components/combobox.js"
import { FilterBar } from "../components/FilterBar.js"
import { SessionRow } from "../components/SessionRow.js"
import { Badge } from "../components/ui/badge.js"
import { Button } from "../components/ui/button.js"
import { Card, CardContent } from "../components/ui/card.js"
import {
  EMPTY_FILTERS,
  localTimeZone,
  parseFilters,
  type SessionFilters,
  serializeFilters,
} from "../sessions/filters.js"
import { LoadingShell } from "../shell/LoadingShell.js"

type State =
  | { readonly phase: "loading"; readonly previous: SessionListPayload | null }
  | { readonly phase: "ready"; readonly payload: SessionListPayload }
  | { readonly phase: "failed"; readonly error: ApiError }

const primaryButtonClass = "mt-4"

const NoResults = ({
  hasFilters,
  onClear,
}: {
  readonly hasFilters: boolean
  readonly onClear: () => void
}) => (
  <Card className="border-dashed p-8 text-center">
    <CardContent className="p-8 text-center">
      <p className="text-sm font-semibold text-muted-foreground">
        {hasFilters ? "Nothing filed under these terms" : "No sessions captured"}
      </p>
      <h2 className="mt-2 text-base font-semibold text-foreground">
        {hasFilters ? "No sessions match these filters" : "There are no sessions to review yet"}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {hasFilters
          ? "The filters above are still applied. Widen them, or clear them to see every session you can read."
          : "Captured sessions will appear here once they are available to you."}
      </p>
      {hasFilters ? (
        <Button type="button" onClick={onClear} className={primaryButtonClass}>
          Clear filters
        </Button>
      ) : null}
    </CardContent>
  </Card>
)

const Denied = ({ onReset }: { readonly onReset: () => void }) => (
  <Card className="border-destructive/40 p-8 text-center">
    <CardContent className="p-0 text-center">
      <p className="text-sm font-semibold text-destructive">Access withheld</p>
      <h2 className="mt-2 text-base font-semibold text-foreground">
        That project cannot be opened
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        It either does not exist or has not been shared with you.
      </p>
      <Button type="button" onClick={onReset} className={primaryButtonClass}>
        Back to all sessions
      </Button>
    </CardContent>
  </Card>
)

const ErrorState = ({ error }: { readonly error: ApiError }) => {
  const invalid = new Set([
    "invalidSearchQuery",
    "invalidPrNumber",
    "invalidCommit",
    "invalidTimeZone",
    "invalidRepo",
    "invalidBranch",
    "invalidPage",
    "invalidLimit",
    "invalidSort",
    "invalidRange",
    "invalidFilter",
  ]).has(error.code ?? "")
  const ambiguous = error.code === "ambiguousCommit"
  return (
    <Card className="border-destructive/40 p-6" role="alert">
      <CardContent className="p-0">
        {" "}
        <p className="text-sm font-semibold text-destructive">
          {ambiguous
            ? "Commit prefix is ambiguous"
            : invalid
              ? "Check your search or filter"
              : "Retrieval failed"}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {ambiguous
            ? "Use more of the commit SHA to identify one authorized commit."
            : invalid
              ? "The search or filter format is not valid. Update it and try again."
              : error.message}
        </p>
      </CardContent>
    </Card>
  )
}

const labelFor = (value: string | null, options: ReadonlyArray<FilterOption>): string | null =>
  value === null ? null : (optionFor(options, value)?.label ?? value)

const ResultSummary = ({
  payload,
  filters,
}: {
  readonly payload: SessionListPayload
  readonly filters: SessionFilters
}) => {
  const scope = [
    labelFor(filters.project, payload.filterOptions.projects),
    labelFor(filters.user, payload.filterOptions.authors),
    labelFor(filters.repo, payload.filterOptions.repositories),
    filters.branch,
    filters.pr === null ? null : `PR #${filters.pr}`,
    filters.commit === null ? null : filters.commit,
  ].filter((value): value is string => value !== null)
  return (
    <div
      className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
      aria-live="polite"
    >
      <div>
        <p className="text-sm font-semibold text-foreground">
          {payload.pagination.total} {payload.pagination.total === 1 ? "session" : "sessions"}
          {filters.q === null ? null : (
            <span className="font-normal text-muted-foreground"> match “{filters.q}”</span>
          )}
        </p>
        {scope.length === 0 ? null : (
          <p className="font-mono text-xs text-muted-foreground">Within {scope.join(" · ")}</p>
        )}
      </div>
      <p className="font-mono text-xs text-muted-foreground">Server-ranked and paginated</p>
    </div>
  )
}

const Pagination = ({
  page,
  totalPages,
  total,
  limit,
  onPage,
}: {
  readonly page: number
  readonly totalPages: number
  readonly total: number
  readonly limit: number
  readonly onPage: (page: number) => void
}) => {
  if (totalPages <= 1 && total === 0) return null
  const first = total === 0 || (page - 1) * limit >= total ? 0 : (page - 1) * limit + 1
  const last = first === 0 ? 0 : Math.min(page * limit, total)
  return (
    <nav
      className="mt-3 grid grid-cols-2 items-center gap-2 border-t pt-3 min-[600px]:grid-cols-[1fr_auto_1fr]"
      aria-label="Search results pagination"
    >
      <Button
        type="button"
        variant="outline"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className="min-[600px]:justify-self-start"
      >
        Previous
      </Button>
      <p className="col-span-2 row-start-1 text-center min-[600px]:col-span-1 min-[600px]:col-start-2">
        <strong className="block text-xs text-foreground">
          Page {page} of {Math.max(totalPages, 1)}
        </strong>
        <span className="font-mono text-xs text-muted-foreground">
          Showing {first}–{last} of {total} sessions
        </span>
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={() => onPage(page + 1)}
        disabled={totalPages === 0 || page >= totalPages}
        className="min-[600px]:col-start-3 min-[600px]:justify-self-end"
      >
        Next
      </Button>
    </nav>
  )
}

export const Sessions = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.toString()
  const filters = useMemo(() => parseFilters(new URLSearchParams(query)), [query])
  const effectiveFilters = useMemo(() => {
    if ((filters.range !== "today" && filters.range !== "custom") || filters.tz !== null)
      return filters
    const tz = localTimeZone()
    return tz === null ? filters : { ...filters, tz }
  }, [filters])
  const effectiveQuery = useMemo(
    () => serializeFilters(effectiveFilters).toString(),
    [effectiveFilters],
  )
  const [state, setState] = useState<State>({ phase: "loading", previous: null })
  const [_showFilters, _setShowFilters] = useState(false)

  const applyFilters = (next: SessionFilters) => setSearchParams(serializeFilters(next))
  const resetFilters = () => applyFilters(EMPTY_FILTERS)

  useEffect(() => {
    const controller = new AbortController()
    setState((current) => ({
      phase: "loading",
      previous:
        current.phase === "ready"
          ? current.payload
          : current.phase === "loading"
            ? current.previous
            : null,
    }))

    const query = Object.fromEntries(new URLSearchParams(effectiveQuery))

    request(() =>
      client.api.sessions.$get({ query }, { init: { signal: controller.signal } }),
    ).then((result) => {
      if (controller.signal.aborted) return
      setState(
        result.ok
          ? { phase: "ready", payload: result.data }
          : { phase: "failed", error: result.error },
      )
    })
    return () => controller.abort()
  }, [effectiveQuery])

  useEffect(() => {
    if (effectiveFilters === filters) return
    setSearchParams(serializeFilters(effectiveFilters), { replace: true })
  }, [effectiveFilters, filters, setSearchParams])

  const payload =
    state.phase === "ready" ? state.payload : state.phase === "loading" ? state.previous : null
  const loading = state.phase === "loading"
  const hasFilters = serializeFilters({ ...filters, page: 1 }).toString() !== ""

  const activeFilters = useMemo(() => {
    const active: Array<{ label: string; value: string; key: keyof SessionFilters }> = []
    if (filters.q !== null)
      active.push({ label: `Search: "${filters.q}"`, value: filters.q, key: "q" })
    if (filters.project !== null)
      active.push({ label: `Project: ${filters.project}`, value: filters.project, key: "project" })
    if (filters.user !== null)
      active.push({ label: `User: ${filters.user}`, value: filters.user, key: "user" })
    if (filters.repo !== null)
      active.push({ label: `Repository: ${filters.repo}`, value: filters.repo, key: "repo" })
    if (filters.branch !== null)
      active.push({ label: `Branch: ${filters.branch}`, value: filters.branch, key: "branch" })
    if (filters.pr !== null)
      active.push({ label: `PR: #${filters.pr}`, value: filters.pr, key: "pr" })
    if (filters.commit !== null)
      active.push({ label: `Commit: ${filters.commit}`, value: filters.commit, key: "commit" })
    if (filters.aiReview !== null)
      active.push({
        label: `AI Review: ${filters.aiReview}`,
        value: filters.aiReview,
        key: "aiReview",
      })
    if (filters.minTokens !== null)
      active.push({
        label: `Min tokens: ${filters.minTokens}`,
        value: String(filters.minTokens),
        key: "minTokens",
      })
    if (filters.maxTokens !== null)
      active.push({
        label: `Max tokens: ${filters.maxTokens}`,
        value: String(filters.maxTokens),
        key: "maxTokens",
      })
    if (filters.minMinutes !== null)
      active.push({
        label: `Min minutes: ${filters.minMinutes}`,
        value: String(filters.minMinutes),
        key: "minMinutes",
      })
    if (filters.maxMinutes !== null)
      active.push({
        label: `Max minutes: ${filters.maxMinutes}`,
        value: String(filters.maxMinutes),
        key: "maxMinutes",
      })
    if (filters.range !== "all")
      active.push({ label: `Range: ${filters.range}`, value: filters.range, key: "range" })
    if (filters.sort !== "recent")
      active.push({ label: `Sort: ${filters.sort}`, value: filters.sort, key: "sort" })
    return active
  }, [filters])

  const clearFilter = (key: keyof SessionFilters) => {
    const next = { ...filters, [key]: EMPTY_FILTERS[key] } as SessionFilters
    applyFilters(next)
  }

  // After every hook: an early return above the useMemos crashes React with
  // "rendered fewer hooks" when the unauthorized state arrives mid-session.
  if (state.phase === "failed" && state.error.kind === "unauthorized") return <SessionExpired />

  return (
    <section>
      <h1 className="text-lg font-semibold leading-tight">Sessions</h1>
      <div className="mt-4">
        <FilterBar
          filters={filters}
          options={
            payload?.filterOptions ?? { projects: [], authors: [], repositories: [], branches: [] }
          }
          onChange={applyFilters}
          onClear={resetFilters}
        />
      </div>
      {activeFilters.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="status" aria-live="polite">
          <span className="text-xs font-medium text-muted-foreground">Active filters:</span>
          {activeFilters.map(({ label, key }) => (
            <Badge key={key} variant="secondary" className="gap-1.5 px-2 py-0.5">
              {label}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => clearFilter(key)}
                aria-label={`Remove filter: ${label}`}
              >
                <X className="size-3" />
              </Button>
            </Badge>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            className="text-xs"
          >
            Clear all
          </Button>
        </div>
      )}
      <div className="mt-4" aria-busy={loading}>
        {loading && payload === null ? <LoadingShell label="Retrieving sessions" /> : null}
        {state.phase === "failed" ? (
          state.error.kind === "notFound" ? (
            <Denied onReset={resetFilters} />
          ) : (
            <ErrorState error={state.error} />
          )
        ) : null}
        {payload === null ? null : payload.sessions.length === 0 &&
          payload.pagination.total === 0 ? (
          <NoResults hasFilters={hasFilters} onClear={resetFilters} />
        ) : (
          <>
            <ResultSummary payload={payload} filters={filters} />
            <ul className="grid grid-cols-1 gap-1.5">
              {payload.sessions.map((session) => (
                <li key={session.id}>
                  <SessionRow session={session} to={`/sessions/${session.id}`} />
                </li>
              ))}
            </ul>
            <Pagination
              {...payload.pagination}
              onPage={(page) => applyFilters({ ...filters, page })}
            />
          </>
        )}
      </div>
    </section>
  )
}
