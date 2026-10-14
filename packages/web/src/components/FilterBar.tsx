import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react"
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
import { Picker } from "./Picker.js"
import { TextField } from "./TextField.js"
import { Button } from "./ui/button.js"
import { Card, CardContent } from "./ui/card.js"
import { Input } from "./ui/input.js"
import { Label } from "./ui/label.js"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.js"

const asRange = (value: string): Range => RANGES.find((range) => range === value) ?? "all"
const asSort = (value: string): Sort => SORTS.find((sort) => sort === value) ?? "recent"

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
      <Label htmlFor={id}>{label}</Label>
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={options.find((o) => o.value === "")?.label ?? "Select..."} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

const TextFilter = ({
  label,
  value,
  placeholder,
  hint,
  onChange,
}: {
  readonly label: string
  readonly value: string | null
  readonly placeholder: string
  readonly hint?: string
  readonly onChange: (value: string | null) => void
}) => {
  const [draft, setDraft] = useState(value ?? "")
  useEffect(() => setDraft(value ?? ""), [value])

  return (
    <div className="min-w-0">
      <TextField
        label={label}
        value={draft}
        onChange={(v) => {
          setDraft(v)
          onChange(v === "" ? null : v)
        }}
        placeholder={placeholder}
        hint={hint}
      />
    </div>
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
  onChange,
}: {
  readonly label: string
  readonly value: number | null
  readonly placeholder: string
  readonly onChange: (value: number | null) => void
}) => (
  <TextFilter
    label={label}
    value={value === null ? null : String(value)}
    placeholder={placeholder}
    onChange={(raw) => onChange(raw === null ? null : parseCount(raw))}
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
        <Label htmlFor={id}>Last active</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(changedFilters(filters, { range: "all", from: null, to: null }))}
          className="text-xs"
        >
          Reset
        </Button>
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1.5">
        <Input
          id={id}
          type="date"
          value={filters.from ?? ""}
          max={filters.to ?? undefined}
          aria-label="From date"
          className="w-auto"
          onChange={(event) =>
            onChange(changedFilters(filters, { from: event.target.value || null }))
          }
        />
        <span aria-hidden="true" className="shrink-0 font-mono text-xs text-muted-foreground">
          →
        </span>
        <Input
          type="date"
          value={filters.to ?? ""}
          min={filters.from ?? undefined}
          aria-label="To date"
          className="w-auto"
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
  const [showAdvanced, setShowAdvanced] = useState(() =>
    // Filters already applied via the URL open the panel — hiding an active filter reads as
    // the page ignoring what the user asked for.
    Object.entries(filters).some(
      ([key, value]) => key !== "q" && key !== "sort" && value !== null && value !== "",
    ),
  )

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
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
  }

  return (
    <Card aria-label="Search and filter sessions" className="p-3">
      <CardContent className="p-0">
        {" "}
        <form
          className="grid grid-cols-1 items-end gap-2 min-[600px]:grid-cols-[minmax(0,1fr)_auto]"
          onSubmit={handleSearchSubmit}
        >
          <div className="min-w-0">
            <Label htmlFor={searchId}>Search session evidence</Label>
            <div className="relative mt-1">
              <Input
                id={searchId}
                type="search"
                className="h-9 pl-9 pr-14"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Terms, phrases, or OR"
                aria-describedby={`${searchId}-help`}
              />
              <svg
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground hover:underline"
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
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="gap-1.5"
            aria-expanded={showAdvanced}
          >
            <SlidersHorizontal className="size-3.5" />
            Filters
            {showAdvanced ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClear} className="text-xs">
            Reset search & filters
          </Button>
        </div>
        {showAdvanced && (
          <div className="mt-2 grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 min-[1000px]:grid-cols-4">
            <Picker
              label="Project"
              value={filters.project ?? ""}
              options={options.projects}
              placeholder="All projects"
              onChange={(project) =>
                onChange(changedFilters(filters, { project: project || null }))
              }
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
              onChange={(pr) => onChange(changedFilters(filters, { pr }))}
            />
            <TextFilter
              label="Commit SHA"
              value={filters.commit}
              placeholder="7–40 hex characters"
              hint="Use a full SHA or an unambiguous seven to forty character hexadecimal prefix."
              onChange={(commit) =>
                onChange(changedFilters(filters, { commit: commit?.trim().toLowerCase() ?? null }))
              }
            />
            <RangeControl filters={filters} onChange={onChange} />
            <CountFilter
              label="Min tokens"
              value={filters.minTokens}
              placeholder="e.g. 1000"
              onChange={(minTokens) => onChange(changedFilters(filters, { minTokens }))}
            />
            <CountFilter
              label="Max tokens"
              value={filters.maxTokens}
              placeholder="e.g. 50000"
              onChange={(maxTokens) => onChange(changedFilters(filters, { maxTokens }))}
            />
            <CountFilter
              label="Min minutes"
              value={filters.minMinutes}
              placeholder="e.g. 5"
              onChange={(minMinutes) => onChange(changedFilters(filters, { minMinutes }))}
            />
            <CountFilter
              label="Max minutes"
              value={filters.maxMinutes}
              placeholder="e.g. 120"
              onChange={(maxMinutes) => onChange(changedFilters(filters, { maxMinutes }))}
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
        )}
      </CardContent>
    </Card>
  )
}
