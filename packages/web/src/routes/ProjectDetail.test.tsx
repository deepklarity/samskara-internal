import { render, screen, waitFor } from "@testing-library/react"
import { Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { ProjectDetail as ProjectDetailPayload } from "../api/types.js"
import { TestRouter } from "../tests/test-router.js"
import { ProjectDetail } from "./ProjectDetail.js"

const PROJECT: ProjectDetailPayload = {
  id: "p-1",
  name: "samskara",
  slug: "samskara",
  owner: { type: "user", slug: "kgritesh" },
  sessionCount: 12,
  lastActiveAt: "2026-02-01T09:30:00.000Z",
  repo: null,
}

const renderDetail = (
  project: ProjectDetailPayload,
  options: { entry?: string; viewerCanDelete?: boolean } = {},
) => {
  const { entry = "/projects/p-1", viewerCanDelete = false } = options
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = typeof input === "string" ? input : String(input)
    if (url.includes("/api/projects/")) {
      return Promise.resolve(
        new Response(JSON.stringify({ project, viewerCanDelete }), { status: 200 }),
      )
    }
    return Promise.resolve(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }))
  })

  return render(
    <TestRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/projects/:id" element={<ProjectDetail />} />
      </Routes>
    </TestRouter>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

test("SC1: a project page shows the project's name, slug, owner and session count, with a link to its sessions", async () => {
  renderDetail(PROJECT)

  await screen.findByRole("heading", { name: "samskara" })
  // Name and slug are both literally "samskara" here, so both must be on the page at once.
  expect(screen.getAllByText("samskara")).toHaveLength(2)
  expect(screen.getByText("kgritesh")).toBeInTheDocument()
  expect(screen.getByText("12")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: /sessions/i })).toHaveAttribute(
    "href",
    "/sessions?project=p-1",
  )
})

test("SC1b: every project session is listed, not just the first few", async () => {
  const sessions = Array.from({ length: 24 }, (_, i) => ({
    id: `s-${i}`,
    title: `Session ${i}`,
    projectId: "p-1",
    projectName: "samskara",
    projectSlug: "samskara",
    userLogin: "kgritesh",
    repo: null,
    durationMs: 60_000,
    tokensTotal: 1_000,
    tokensInput: 600,
    tokensOutput: 400,
    tokensCached: 0,
    status: "complete",
    lastActiveAt: "2026-02-01T09:30:00.000Z",
    hasAiReview: false,
  }))
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = typeof input === "string" ? input : String(input)
    if (url.includes("/api/projects/")) {
      return Promise.resolve(
        new Response(JSON.stringify({ project: PROJECT, viewerCanDelete: false }), {
          status: 200,
        }),
      )
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({ sessions, pagination: { page: 1, limit: 100, total: 24 } }),
        { status: 200 },
      ),
    )
  })

  const { unmount } = render(
    <TestRouter initialEntries={["/projects/p-1"]}>
      <Routes>
        <Route path="/projects/:id" element={<ProjectDetail />} />
      </Routes>
    </TestRouter>,
  )
  await screen.findByRole("heading", { name: "samskara" })
  // The first page of ten renders; the rest are one click away, never silently missing.
  const rows = () => screen.getAllByRole("listitem").filter((item) => item.textContent !== "")
  await waitFor(() => expect(rows()).toHaveLength(10))
  expect(rows()[0]?.textContent).toContain("Session 0")
  const more = screen.getByRole("button", { name: /show more/i })
  expect(more).toHaveTextContent("14 remaining")
  more.click()
  await waitFor(() => expect(rows()).toHaveLength(24))
  expect(rows()[23]?.textContent).toContain("Session 23")
  unmount()
})

test("SC2: the owner line follows who owns the project - org slug marked as an org, user login not marked", async () => {
  const { unmount } = renderDetail({
    ...PROJECT,
    owner: { type: "org", slug: "vertexcover-io" },
  })

  await waitFor(() => expect(screen.getByText(/vertexcover-io/)).toBeInTheDocument())
  expect(screen.getByRole("link", { name: /org · vertexcover-io/ })).toHaveAttribute(
    "href",
    "/orgs/vertexcover-io",
  )
  unmount()

  renderDetail({ ...PROJECT, owner: { type: "user", slug: "kgritesh" } })

  await waitFor(() => expect(screen.getByText("kgritesh")).toBeInTheDocument())
  expect(screen.queryByText(/org ·/)).not.toBeInTheDocument()
})

test("SC10: a viewer who may not delete is offered no delete control", async () => {
  renderDetail(PROJECT, { viewerCanDelete: false })

  await screen.findByRole("heading", { name: "samskara" })
  expect(screen.queryByRole("button", { name: /delete project/i })).not.toBeInTheDocument()
})

test("SC10: a project with a linked repo renders it as a GitHub link, and a remoteless project shows no repo field", async () => {
  const { unmount } = renderDetail({
    ...PROJECT,
    repo: { host: "github.com", owner: "vertexcover-io", repoName: "samskara" },
  })

  await screen.findByRole("heading", { name: "samskara" })
  expect(screen.getByRole("link", { name: "vertexcover-io/samskara" })).toHaveAttribute(
    "href",
    "https://github.com/vertexcover-io/samskara",
  )
  expect(screen.getByText("Repository")).toBeInTheDocument()
  unmount()

  renderDetail(PROJECT)
  await screen.findByRole("heading", { name: "samskara" })
  expect(screen.queryByText("Repository")).not.toBeInTheDocument()
})
