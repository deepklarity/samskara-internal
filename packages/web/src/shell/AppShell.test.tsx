import { render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { AppRoutes } from "../App.js"
import type { CurrentUser } from "../api/types.js"
import { TestRouter } from "../tests/test-router.js"

const user: CurrentUser = {
  id: "u-1",
  githubLogin: "e2e-user",
  email: "e2e@example.com",
  name: "E2E User",
  avatarUrl: null,
  isSuperAdmin: false,
}

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

afterEach(() => {
  vi.unstubAllGlobals()
})

test("M1: on narrow viewports the primary nav scrolls as one row instead of wrapping, and the account badge never stretches full-width", async () => {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const path = typeof input === "string" ? input : input.toString()
    if (path.endsWith("/api/auth/me")) return Promise.resolve(jsonResponse(200, user))
    if (path.endsWith("/api/projects")) return Promise.resolve(jsonResponse(200, { projects: [] }))
    return Promise.reject(new Error(`unstubbed fetch: ${path}`))
  })

  render(
    <TestRouter initialEntries={["/projects"]}>
      <AppRoutes />
    </TestRouter>,
  )

  const nav = await screen.findByRole("navigation", { name: /primary/i })
  expect(nav.className).toContain("whitespace-nowrap")
  expect(nav.className).toContain("overflow-x-auto")
  // Full-width second row under brand + badge, so the links get room to scroll in.
  expect(nav.className).toContain("max-sm:order-3")
  expect(nav.className).toContain("max-sm:basis-full")

  const trigger = await screen.findByRole("button", { name: /account menu/i })
  expect(trigger.className).toContain("max-sm:truncate")
  expect(trigger.parentElement?.className).toContain("shrink-0")
})
