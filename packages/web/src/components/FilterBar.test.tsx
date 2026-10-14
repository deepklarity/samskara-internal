import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test, vi } from "vitest"
import type { SessionFilterOptions } from "../api/types.js"
import { EMPTY_FILTERS, type SessionFilters } from "../sessions/filters.js"
import { FilterBar } from "./FilterBar.js"

const options: SessionFilterOptions = {
  projects: [{ value: "samskara", label: "Samskara" }],
  authors: [{ value: "maya", label: "maya" }],
  repositories: [
    {
      value: "repo-1",
      label: "acme/samskara",
      host: "github.com",
      owner: "acme",
      repoName: "samskara",
    },
  ],
  branches: ["main", "feat/Search"],
}

const renderBar = (filters: SessionFilters = EMPTY_FILTERS) => {
  const onChange = vi.fn()
  const onClear = vi.fn()
  render(<FilterBar filters={filters} options={options} onChange={onChange} onClear={onClear} />)
  return { onChange, onClear }
}

const openFilters = async (user: ReturnType<typeof userEvent.setup>) => {
  // Active filters auto-open the panel; only click when it is actually closed.
  const toggle = screen.queryByRole("button", { name: "Filters", expanded: false })
  if (toggle) await user.click(toggle)
}

const choose = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  typed: string,
  option: string,
): Promise<void> => {
  await user.type(screen.getByRole("combobox", { name }), typed)
  await user.click(screen.getByRole("option", { name: option }))
}

test("submits keyword search intentionally and defaults it to relevance on page one", async () => {
  const user = userEvent.setup()
  const { onChange } = renderBar({ ...EMPTY_FILTERS, page: 3 })

  await user.type(
    screen.getByRole("searchbox", { name: /search session evidence/i }),
    "deployment timeout",
  )
  expect(onChange).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button", { name: "Search" }))

  expect(onChange).toHaveBeenCalledWith({
    ...EMPTY_FILTERS,
    q: "deployment timeout",
    sort: "relevance",
  })
})

test("clear search removes relevance and reset clears every control", async () => {
  const user = userEvent.setup()
  const active = {
    ...EMPTY_FILTERS,
    q: "timeout",
    project: "samskara",
    repo: "repo-1",
    branch: "main",
    sort: "relevance" as const,
    page: 2,
  }
  const { onChange, onClear } = renderBar(active)

  await user.click(screen.getByRole("button", { name: /clear search/i }))
  expect(onChange).toHaveBeenCalledWith({
    ...EMPTY_FILTERS,
    project: "samskara",
    repo: "repo-1",
    branch: "main",
  })

  await user.click(screen.getByRole("button", { name: /reset search & filters/i }))
  expect(onClear).toHaveBeenCalledOnce()
})

test("SC64: uses server vocabulary, preserves exact branch case, and deliberately applies PR and commit text", async () => {
  const user = userEvent.setup()
  const { onChange } = renderBar({ ...EMPTY_FILTERS, page: 2 })
  await openFilters(user)

  for (const placeholder of ["All projects", "All users", "All repositories", "All branches"]) {
    expect(screen.getByPlaceholderText(placeholder)).toBeInTheDocument()
  }

  await choose(user, "Repository", "acme", "acme/samskara")
  expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, repo: "repo-1" })

  await choose(user, "Branch", "feat/search", "feat/Search")
  expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, branch: "feat/Search" })

  await user.type(screen.getByRole("textbox", { name: "PR number" }), "001")
  await user.keyboard("{Enter}")
  expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, pr: "001" })

  await user.type(screen.getByRole("textbox", { name: "Commit SHA" }), "ABCDEF1")
  await user.keyboard("{Enter}")
  expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, commit: "abcdef1" })
})

test("SC65 (regression): Last active and Sort by are shadcn Select components", async () => {
  const user = userEvent.setup()
  const { onChange } = renderBar()
  await openFilters(user)

  const lastActive = screen.getByRole("combobox", { name: "Last active" })
  const sortBy = screen.getByRole("combobox", { name: "Sort by" })
  expect(lastActive).toBeInTheDocument()
  expect(sortBy).toBeInTheDocument()
  // They are shadcn Select triggers (buttons with combobox role), not native selects
  expect(lastActive.tagName).toBe("BUTTON")
  expect(sortBy.tagName).toBe("BUTTON")

  // Verify the sort can be changed via keyboard (relevance -> recent -> oldest -> tokens = 3 ArrowDown)
  await user.click(sortBy)
  await user.keyboard("{ArrowDown}") // recent
  await user.keyboard("{ArrowDown}") // oldest
  await user.keyboard("{ArrowDown}") // tokens
  await user.keyboard("{Enter}")
  expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, sort: "tokens" })
})

test("token and duration bounds apply on change without Apply buttons", async () => {
  const user = userEvent.setup()
  const { onChange } = renderBar({ ...EMPTY_FILTERS, page: 2 })
  await openFilters(user)

  await user.type(screen.getByRole("textbox", { name: "Min tokens" }), "1000")
  await user.keyboard("{Enter}")
  expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, minTokens: 1000 })

  await user.type(screen.getByRole("textbox", { name: "Max minutes" }), "120")
  await user.keyboard("{Enter}")
  expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, maxMinutes: 120 })
})
