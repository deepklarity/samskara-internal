import { render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
import { type Tab, Tabs } from "./Tabs.js"

const TABS: ReadonlyArray<Tab> = [
  { id: "conversation", label: "Conversation", count: 69 },
  { id: "tools", label: "Tool Calls", count: 240 },
  { id: "artifacts", label: "Artifacts", count: 3 },
  { id: "commits", label: "Commits", count: 0 },
  { id: "pulls", label: "Pull Requests", count: 0 },
  { id: "review", label: "Review", count: 1 },
]

describe("Tabs", () => {
  test("tab buttons never wrap mid-label, so narrow viewports scroll whole tabs instead of clipping text", () => {
    render(<Tabs tabs={TABS} selected="review" onSelect={vi.fn()} />)
    for (const tab of TABS) {
      const button = screen.getByRole("tab", { name: new RegExp(tab.label) })
      expect(button.className).toContain("whitespace-nowrap")
    }
  })
})
