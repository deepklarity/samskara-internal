import { describe, expect, test } from "vitest"
import { failedSeqsOf, timelineTone } from "./timelineTone.js"

const messages = [
  { id: "m-1", lineNumber: 1 },
  { id: "m-2", lineNumber: 2 },
  { id: "m-3", lineNumber: 3 },
] as const

describe("timelineTone", () => {
  test("clean stretch with no failures and a short span reads good", () => {
    const failed = failedSeqsOf([...messages], [])
    expect(timelineTone({ fromSeq: 1, toSeq: 3, durationMs: 5_000 }, failed, 600_000)).toBe("good")
  })

  test("a failed tool result inside the entry seq range reads failure", () => {
    const failed = failedSeqsOf([...messages], [{ messageId: "m-2", status: "failure" }])
    expect(timelineTone({ fromSeq: 1, toSeq: 3, durationMs: 5_000 }, failed, 600_000)).toBe(
      "failure",
    )
  })

  test("an error status also reads failure, and failures outside the range do not", () => {
    const failed = failedSeqsOf([...messages], [{ messageId: "m-3", status: "error" }])
    expect(timelineTone({ fromSeq: 1, toSeq: 2 }, failed, 600_000)).toBe("good")
    expect(timelineTone({ fromSeq: 2, toSeq: 3 }, failed, 600_000)).toBe("failure")
  })

  test("a large duration share of the session reads slow", () => {
    const failed = failedSeqsOf([...messages], [])
    expect(timelineTone({ fromSeq: 1, toSeq: 2, durationMs: 300_000 }, failed, 600_000)).toBe(
      "slow",
    )
  })

  test("failure wins over slow when both apply", () => {
    const failed = failedSeqsOf([...messages], [{ messageId: "m-1", status: "failed" }])
    expect(timelineTone({ fromSeq: 1, toSeq: 1, durationMs: 500_000 }, failed, 600_000)).toBe(
      "failure",
    )
  })

  test("empty range never matches a failure and reads good", () => {
    const failed = failedSeqsOf([...messages], [{ messageId: "m-1", status: "failure" }])
    expect(timelineTone({ fromSeq: 5, toSeq: 2, durationMs: 1_000 }, failed, 600_000)).toBe("good")
  })

  test("a turning point keeps its accent instead of reading slow", () => {
    const failed = failedSeqsOf([...messages], [])
    expect(
      timelineTone(
        { fromSeq: 1, toSeq: 2, durationMs: 300_000, kind: "turning-point" },
        failed,
        600_000,
      ),
    ).toBe("good")
  })

  test("missing timestamps never read slow, even with a large total", () => {
    const failed = failedSeqsOf([...messages], [])
    expect(timelineTone({ fromSeq: 1, toSeq: 2 }, failed, 600_000)).toBe("good")
    expect(timelineTone({ fromSeq: 1, toSeq: 2, durationMs: 0 }, failed, 600_000)).toBe("good")
  })
})
