import { afterEach, expect, test, vi } from "vitest"
import { fetchAiReview, fetchAiReviewJob, startAiReview } from "./review.js"

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const stubFetch = (...replies: Response[]): { readonly urls: ReadonlyArray<string> } => {
  const urls: string[] = []
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    urls.push(typeof input === "string" ? input : String(input))
    return replies.shift() ?? response(500, { error: "exhausted" })
  })
  return { urls }
}

afterEach(() => vi.restoreAllMocks())

test("AR1: a running job comes back alongside a null review, so a reload can rejoin it", async () => {
  const job = {
    jobId: "job-1",
    status: "running",
    startedAt: "2026-08-26T20:00:00.000Z",
    lastEvent: { name: "harness_first_byte", at: "2026-08-26T20:00:04.000Z" },
  }
  const { urls } = stubFetch(response(200, { review: null, job }))

  const result = await fetchAiReview("s-1")

  expect(result).toEqual({ ok: true, data: { review: null, job } })
  expect(urls[0]).toContain("/api/sessions/s-1/aireview")
})

test("AR2: a landed review without a running job maps to a null job, keeping the old shape honest", async () => {
  const review = { id: "rev-1", createdAt: "2026-08-26T20:01:00.000Z", outcome: "productive" }
  stubFetch(response(200, { review }))

  const result = await fetchAiReview("s-1")

  expect(result).toEqual({ ok: true, data: { review, job: null } })
})

test("AR3: a 404 noAiReview still means not-yet — null review, null job, no error", async () => {
  stubFetch(response(404, { error: "noAiReview" }))

  const result = await fetchAiReview("s-1")

  expect(result).toEqual({ ok: true, data: { review: null, job: null } })
})

test("AR4: fetchAiReviewJob 200-failed returns the terminal code", async () => {
  const job = { jobId: "job-9", status: "failed", code: "ungrounded" }
  stubFetch(response(200, { job }))

  const result = await fetchAiReviewJob("s-1", "job-9")

  expect(result).toEqual({ ok: true, data: job })
})

test("AR5: fetchAiReviewJob 404 maps to null (registry dropped it), not an error", async () => {
  stubFetch(response(404, { error: "jobNotFound" }))

  const result = await fetchAiReviewJob("s-1", "job-gone")

  expect(result).toEqual({ ok: true, data: null })
})

test("AR6: fetchAiReviewJob 500 passes the error through", async () => {
  stubFetch(response(500, { error: "boom" }))

  const result = await fetchAiReviewJob("s-1", "job-9")

  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.kind).toBe("server")
})

test("AR7: startAiReview 202 returns the jobId", async () => {
  stubFetch(response(202, { jobId: "job-2" }))

  const result = await startAiReview("s-1")

  expect(result).toEqual({ ok: true, data: { jobId: "job-2" } })
})

test("AR8: startAiReview 409 surfaces a typed error, not a throw", async () => {
  stubFetch(response(409, { error: "analysisAlreadyRunning" }))

  const result = await startAiReview("s-1")

  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe("analysisAlreadyRunning")
})

test("AR9: startAiReview 503 surfaces a typed error, not a throw", async () => {
  stubFetch(response(503, { error: "busy" }))

  const result = await startAiReview("s-1")

  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe("busy")
})
