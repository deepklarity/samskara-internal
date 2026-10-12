import { describe, expect, test } from "vitest"
import { paginate, parseSessionListQuery } from "./sessionFilters.js"

describe("paginate", () => {
  test("SC14: every page count equals the total divided by the limit, rounded up", () => {
    expect(paginate(0, 1, 50)).toEqual({ page: 1, limit: 50, total: 0, totalPages: 0 })
    expect(paginate(1, 1, 50)).toEqual({ page: 1, limit: 50, total: 1, totalPages: 1 })
    expect(paginate(50, 1, 50)).toEqual({ page: 1, limit: 50, total: 50, totalPages: 1 })
    expect(paginate(51, 1, 50)).toEqual({ page: 1, limit: 50, total: 51, totalPages: 2 })
    expect(paginate(51, 2, 50)).toEqual({ page: 2, limit: 50, total: 51, totalPages: 2 })
  })
})

describe("token and duration filters", () => {
  test("T1: parses minTokens/maxTokens/minMinutes/maxMinutes", () => {
    const parsed = parseSessionListQuery({
      minTokens: "100",
      maxTokens: "5000",
      minMinutes: "2",
      maxMinutes: "60",
    })
    expect(parsed.minTokens).toBe(100)
    expect(parsed.maxTokens).toBe(5000)
    expect(parsed.minMinutes).toBe(2)
    expect(parsed.maxMinutes).toBe(60)
  })

  test("T2: rejects negative bounds and min greater than max", () => {
    expect(() => parseSessionListQuery({ minTokens: "-1" })).toThrow()
    expect(() => parseSessionListQuery({ maxTokens: "-5" })).toThrow()
    expect(() => parseSessionListQuery({ minMinutes: "-1" })).toThrow()
    expect(() => parseSessionListQuery({ minTokens: "10", maxTokens: "5" })).toThrow()
    expect(() => parseSessionListQuery({ minMinutes: "60", maxMinutes: "2" })).toThrow()
  })
})
