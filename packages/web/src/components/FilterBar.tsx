import { useEffect, useId, useState } from "react"
import type { SessionFilterOptions } from "../api/types.js"
import {
  type AiReviewState,
  changedFilters,
  RANGE_LABEL,
  RANGES,
  type Range,
  type SessionFilters,
  SORT_LABEL,
  SORTS,
  type Sort,
} from "../sessions/filters.js"
import { Caret } from "./combobox.js"
import { Picker } from "./Picker.js"
import { controlClass, labelClass, TextField } from "./TextField.js"
import { Button } from "./ui/button.js"
import { Card, CardContent } from "./ui/card.js"

const asRange = (value: string): Range => RANGES.find((range) => range === value) ?? "all"
const asSort = (value: string): Sort => SORTS.find((sort) => sort === value) ?? "recent"

// A native select styled as a shadcn trigger: the chevron is drawn, not faked with a
// second element, and the control keeps a real focus ring.
const selectClass = `${controlClass} mt-0 cursor-pointer appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-9`

/** Its two callers map over client constants, so this shape is not the server's to change. */
type Choosable = { readonly value: string; readonly label: string }

type ChoiceProps = {
  readonly label: string
  readonly value: string
  readonly options: ReadonlyArray<Choosable>
  readonly onChange: (value: string) => void
}

const Choice = ({ label, value, options, onChange }: ChoiceProps) => {
  const id = useId()
  return (
    <div className="min-w-0">
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <div className="relative mt-1">
        <select
          id={id}
          className={selectClass}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Caret className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-soft" />
      </div>
    </div>
  )
}

const TextFilter = ({
  label,
  value,
  placeholder,
  hint,
  onSubmit,
}: {
  readonly label: string
  readonly value: string | null
  readonly placeholder: string
  readonly hint?: string
  readonly onSubmit: (value: string | null) => void
}) => {
  const [draft, setDraft] = useState(value ?? "")
  useEffect(() => setDraft(value ?? ""), [value])

  return (
    <form
      className="min-w-0"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(draft === "" ? null : draft)
      }}
    >
      <TextField
        label={label}
        value={draft}
        onChange={setDraft}
        placeholder={placeholder}
        hint={hint}
        trailing={
          <Button type="submit" variant="secondary" size="sm" className="shrink-0">
            Apply
          </Button>
        }
      />
    </form>
  )
}

const parseCount = (value: string | null): number | null => {
  if (value === null) return null
  const text = value.trim()
  if (!/^[0-9]+$/.test(text)) return null
  const count = Number(text)
  return Number.isSafeInteger(count) ? count : null
}

const CountFilter = ({
  label,
  value,
  placeholder,
  onSubmit,
}: {
  readonly label: string
  readonly value: number | null
  readonly placeholder: string
  readonly onSubmit: (value: number | null) => void
}) => (
  <TextFilter
    label={label}
    value={value === null ? null : String(value)}
    placeholder={placeholder}
    onSubmit={(raw) => onSubmit(raw === null ? null : parseCount(raw))}
  />
)

const RangeControl = ({
  filters,
  onChange,
}: {
  readonly filters: SessionFilters
  readonly onChange: (filters: SessionFilters) => void
}) => {
  const id = useId()
  if (filters.range !== "custom") {
    return (
      <Choice
        label="Last active"
        value={filters.range}
        options={RANGES.map((range) => ({ value: range, label: RANGE_LABEL[range] }))}
        onChange={(range) =>
          onChange(changedFilters(filters, { range: asRange(range), from: null, to: null }))
        }
      />
    )
  }

  return (
    <div className="min-w-0 min-[560px]:col-span-2">
      <div className="flex items-baseline justify-between gap-2">
        <label className={labelClass} htmlFor={id}>
          Last active
        </label>
        <button
          type="button"
          onClick={() => onChange(changedFilters(filters, { range: "all", from: null, to: null }))}
          className="text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-custody hover:underline"
        >
          Reset
        </button>
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1.5">
        <input
          id={id}
          type="date"
          value={filters.from ?? ""}
          max={filters.to ?? undefined}
          aria-label="From date"
          className={`${controlClass} mt-0`}
          onChange={(event) =>
            onChange(changedFilters(filters, { from: event.target.value || null }))
          }
        />
        <span aria-hidden="true" className="shrink-0 font-mono text-[0.72rem] text-faded">
          →
        </span>
        <input
          type="date"
          value={filters.to ?? ""}
          min={filters.from ?? undefined}
          aria-label="To date"
          className={`${controlClass} mt-0`}
          onChange={(event) =>
            onChange(changedFilters(filters, { to: event.target.value || null }))
          }
        />
      </div>
    </div>
  )
}

type Props = {
  readonly filters: SessionFilters
  readonly options: SessionFilterOptions
  readonly onChange: (filters: SessionFilters) => void
  readonly onClear: () => void
}

export const FilterBar = ({ filters, options, onChange, onClear }: Props) => {
  const [query, setQuery] = useState(filters.q ?? "")
  const searchId = useId()
  const sorts = filters.q === null ? SORTS.filter((sort) => sort !== "relevance") : SORTS
  useEffect(() => setQuery(filters.q ?? ""), [filters.q])

  return (
    <Card aria-label="Search and filter sessions" className="bg-panel p-3">
      <CardContent className="p-0">
        {" "}
        <form
          className="grid grid-cols-1 items-end gap-2 min-[600px]:grid-cols-[minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            const q = query.trim() || null
            onChange(
              changedFilters(filters, {
                q,
                sort:
                  q === null && filters.sort === "relevance"
                    ? "recent"
                    : filters.sort === "recent" && q !== null
                      ? "relevance"
                      : filters.sort,
              }),
            )
          }}
        >
          <div className="min-w-0">
            <label className={labelClass} htmlFor={searchId}>
              Search session evidence
            </label>
            <div className="relative mt-1">
              <input
                id={searchId}
                type="search"
                className={`${controlClass} mt-0 h-10 pl-9 pr-14`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Terms, phrases, or OR"
                aria-describedby={`${searchId}-help`}
              />
              <svg
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-4-4" />
              </svg>
              {query === "" ? null : (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("")
                    onChange(
                      changedFilters(filters, {
                        q: null,
                        sort: filters.sort === "relevance" ? "recent" : filters.sort,
                      }),
                    )
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[0.68rem] font-semibold text-custody hover:underline"
                  aria-label="Clear search"
                >
                  Clear
                </button>
              )}
            </div>
            <span id={`${searchId}-help`} className="sr-only">
              Search titles, messages, pull requests, tool calls, and tool results you are
              authorized to read.
            </span>
          </div>
          <Button type="submit">Search</Button>
        </form>
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-rule pt-3">
          <span className={labelClass}>Narrow the case file</span>
          <button
            type="button"
            onClick={onClear}
            className="text-[0.68rem] font-semibold text-custody hover:underline"
          >
            Reset search &amp; filters
          </button>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 min-[1000px]:grid-cols-4">
          <Picker
            label="Project"
            value={filters.project ?? ""}
            options={options.projects}
            placeholder="All projects"
            onChange={(project) => onChange(changedFilters(filters, { project: project || null }))}
          />
          <Picker
            label="User"
            value={filters.user ?? ""}
            options={options.authors}
            placeholder="All users"
            onChange={(user) => onChange(changedFilters(filters, { user: user || null }))}
          />
          <Picker
            label="Repository"
            value={filters.repo ?? ""}
            options={options.repositories}
            placeholder="All repositories"
            onChange={(repo) => onChange(changedFilters(filters, { repo: repo || null }))}
          />
          <Picker
            label="Branch"
            value={filters.branch ?? ""}
            options={options.branches.map((branch) => ({ value: branch, label: branch }))}
            placeholder="All branches"
            onChange={(branch) => onChange(changedFilters(filters, { branch: branch || null }))}
          />
          <TextFilter
            label="PR number"
            value={filters.pr}
            placeholder="e.g. 42"
            hint="Enter a canonical positive pull request number."
            onSubmit={(pr) => onChange(changedFilters(filters, { pr }))}
          />
          <TextFilter
            label="Commit SHA"
            value={filters.commit}
            placeholder="7–40 hex characters"
            hint="Use a full SHA or an unambiguous seven to forty character hexadecimal prefix."
            onSubmit={(commit) =>
              onChange(changedFilters(filters, { commit: commit?.trim().toLowerCase() ?? null }))
            }
          />
          <RangeControl filters={filters} onChange={onChange} />
          <CountFilter
            label="Min tokens"
            value={filters.minTokens}
            placeholder="e.g. 1000"
            onSubmit={(minTokens) => onChange(changedFilters(filters, { minTokens }))}
          />
          <CountFilter
            label="Max tokens"
            value={filters.maxTokens}
            placeholder="e.g. 50000"
            onSubmit={(maxTokens) => onChange(changedFilters(filters, { maxTokens }))}
          />
          <CountFilter
            label="Min minutes"
            value={filters.minMinutes}
            placeholder="e.g. 5"
            onSubmit={(minMinutes) => onChange(changedFilters(filters, { minMinutes }))}
          />
          <CountFilter
            label="Max minutes"
            value={filters.maxMinutes}
            placeholder="e.g. 120"
            onSubmit={(maxMinutes) => onChange(changedFilters(filters, { maxMinutes }))}
          />
          <Choice
            label="AI analysis"
            value={filters.aiReview ?? ""}
            options={[
              { value: "", label: "Any" },
              { value: "done", label: "Analyzed" },
              { value: "missing", label: "Not analyzed" },
            ]}
            onChange={(aiReview) =>
              onChange(
                changedFilters(filters, {
                  aiReview: aiReview === "" ? null : (aiReview as AiReviewState),
                }),
              )
            }
          />
          <Choice
            label="Sort by"
            value={filters.sort}
            options={sorts.map((sort) => ({ value: sort, label: SORT_LABEL[sort] }))}
            onChange={(sort) => onChange(changedFilters(filters, { sort: asSort(sort) }))}
          />
        </div>
      </CardContent>
    </Card>
  )
}
