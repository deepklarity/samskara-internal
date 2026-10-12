import { render, screen } from "@testing-library/react"
import { expect, test } from "vitest"
import type { SessionSummary } from "../api/types.js"
import { TestRouter } from "../tests/test-router.js"
import { SessionRow } from "./SessionRow.js"

const populated: SessionSummary = {
  id: "s-1",
  title: "Port the session detail surface",
  projectId: "p-1",
  projectName: "Samskara",
  projectSlug: "samskara",
  userLogin: "maya",
  repo: { host: "github.com", owner: "acme", repoName: "samskara" },
  durationMs: 3_723_000,
  tokensTotal: 128_400,
  tokensInput: 90_000,
  tokensOutput: 12_000,
  tokensCached: 26_400,
  status: "complete",
  lastActiveAt: "2026-02-01T09:30:00.000Z",
  hasAiReview: false,
}

const renderRow = (session: SessionSummary) =>
  render(
    <TestRouter initialEntries={["/sessions"]}>
      <SessionRow session={session} to={`/sessions/${session.id}`} />
    </TestRouter>,
  )

test("S18: a row summarises the session on one line - title, who, duration, tokens, project", () => {
  renderRow(populated)

  const row = screen.getByRole("link")

  expect(row).toHaveTextContent("Port the session detail surface")
  expect(row).toHaveTextContent("Samskara")
  expect(row).toHaveTextContent("maya")
  expect(row).toHaveTextContent("acme/samskara")
  expect(row).toHaveTextContent("1h 2m")
  expect(row).toHaveTextContent("↑ 90.0k in")
  expect(row).toHaveTextContent("↓ 12.0k out")
  expect(row).toHaveTextContent("Medium")
})

test("S18: a session with no repo omits it rather than reserving a placeholder for it", () => {
  renderRow({ ...populated, repo: null })

  const row = screen.getByRole("link")
  expect(row).toHaveTextContent("maya · 1h 2m")
  expect(row).not.toHaveTextContent("unavailable")
})

test("S18: a remoteless repo reads as its own name - never the absolute path it is keyed by", () => {
  const repo = { host: "local", owner: "/Users/maya/Projects/samskara", repoName: "samskara" }
  renderRow({ ...populated, repo })

  const row = screen.getByRole("link")
  expect(row).toHaveTextContent("samskara")
  expect(row).not.toHaveTextContent("/Users/maya")
})

test("S26: the row reports capture recency in relative terms rather than a raw timestamp", () => {
  renderRow(populated)

  expect(screen.getByRole("link")).not.toHaveTextContent("2026-02-01T09:30")
})

test("S26: the relative stamp carries the exact moment as a tooltip, so recency never costs precision", () => {
  renderRow(populated)

  expect(screen.getByRole("time")).toHaveAttribute("title", "Feb 1, 2026, 09:30")
})

test("S19: a null duration renders an explicit placeholder - never 0, an em dash, or a fabricated value", () => {
  renderRow({ ...populated, durationMs: null })

  expect(screen.getByText("unavailable")).toBeInTheDocument()

  const row = screen.getByRole("link")
  expect(row).toHaveTextContent("unavailable")
  expect(row).not.toHaveTextContent("null")
  expect(row).not.toHaveTextContent("—")
})

test("S19: a null title reads as 'untitled session' rather than an empty heading", () => {
  renderRow({ ...populated, title: null })

  expect(screen.getByRole("link")).toHaveTextContent("untitled session")
})

test("S26: a zero token total renders as 0 - the 'unavailable' path is reserved for genuinely absent data", () => {
  renderRow({ ...populated, tokensTotal: 0 })

  expect(screen.getByRole("link")).toHaveTextContent("0")
  expect(screen.queryByText("unavailable")).not.toBeInTheDocument()
})

test("S26: token totals scale past thousands rather than reading as five-figure 'k'", () => {
  renderRow({ ...populated, tokensTotal: 12_400_000 })
  expect(screen.getByRole("link")).toHaveTextContent("Very large")

  renderRow({ ...populated, tokensTotal: 2_500_000_000 })
  expect(screen.getAllByRole("link")[1]).toHaveTextContent("Very large")
})

test("S26: the row is a link, so a session opens in a new tab the way any other link does", () => {
  renderRow(populated)

  expect(screen.getByRole("link")).toHaveAttribute("href", "/sessions/s-1")
})

test("S44: a session with a landed AI review wears a badge", () => {
  renderRow({ ...populated, hasAiReview: true })
  expect(screen.getByText("AI review")).toBeInTheDocument()
})

test("S44: a session the AI review has not reached carries no badge", () => {
  renderRow({ ...populated, hasAiReview: false })
  expect(screen.queryByText("AI review")).not.toBeInTheDocument()
})

test("token stack renders in/out lines and a size pill from the total", () => {
  renderRow({
    ...populated,
    tokensTotal: 128_400,
    tokensInput: 100_000,
    tokensOutput: 28_400,
  } as SessionSummary)

  const row = screen.getByRole("link")
  expect(row).toHaveTextContent("↑ 100.0k in")
  expect(row).toHaveTextContent("↓ 28.4k out")
  expect(row).toHaveTextContent("Medium")
  expect(row).not.toHaveTextContent("128.4k tokens")
})

test("token stack shows cached only when non-trivial", () => {
  renderRow({
    ...populated,
    tokensTotal: 128_400,
    tokensInput: 100_000,
    tokensOutput: 28_400,
    tokensCached: 50_000,
  } as SessionSummary)
  expect(screen.getAllByRole("link")[0]).toHaveTextContent("↺ 50.0k cached")

  renderRow({
    ...populated,
    tokensTotal: 128_400,
    tokensInput: 100_000,
    tokensOutput: 28_400,
    tokensCached: 10,
  } as SessionSummary)
  expect(screen.getAllByRole("link")[1]).not.toHaveTextContent("cached")
})

test("size pill buckets Small/Medium/Large/Very large + Long past 2h", () => {
  for (const [total, bucket] of [
    [50_000, "Small"],
    [500_000, "Medium"],
    [5_000_000, "Large"],
    [12_400_000, "Very large"],
  ] as const) {
    renderRow({ ...populated, tokensTotal: total })
  }
  const rows = screen.getAllByRole("link")
  expect(rows[0]).toHaveTextContent("Small")
  expect(rows[1]).toHaveTextContent("Medium")
  expect(rows[2]).toHaveTextContent("Large")
  expect(rows[3]).toHaveTextContent("Very large")
  expect(rows[0]).not.toHaveTextContent("Long")
  renderRow({ ...populated, tokensTotal: 50_000, durationMs: 3 * 60 * 60_000 })
  expect(screen.getAllByRole("link")[4]).toHaveTextContent("Long")
})

test("without a server breakdown the row falls back to the single total line", () => {
  const { tokensInput, tokensOutput, tokensCached, ...withoutBreakdown } = populated
  renderRow(withoutBreakdown as SessionSummary)
  const row = screen.getByRole("link")
  expect(row).toHaveTextContent("128.4k tokens")
  expect(row).not.toHaveTextContent("↑")
})

test("search evidence renders a supported source label and escaped highlighted text", () => {
  renderRow({
    ...populated,
    match: {
      sourceKind: "toolResult",
      sourceRowId: "tool-1",
      score: 1.5,
      snippet: [
        { text: "The <script> value ", highlighted: false },
        { text: "timed out", highlighted: true },
      ],
    },
  })

  expect(screen.getByRole("link")).toHaveTextContent("Tool result")
  expect(document.querySelector("mark")).toHaveTextContent("timed out")
  expect(screen.getByText("The <script> value", { exact: false }).tagName).toBe("SPAN")
  expect(document.querySelector("script")).toBeNull()
})

test("a non-search row has no evidence label or mark", () => {
  renderRow(populated)
  expect(screen.queryByRole("mark")).not.toBeInTheDocument()
  expect(screen.queryByText("Tool result")).not.toBeInTheDocument()
})
