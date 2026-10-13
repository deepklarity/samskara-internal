#!/usr/bin/env bun
/**
 * review-redo — force a fresh Session-Analyzer pass on a session and wait for it.
 *
 *   scripts/review-redo.ts <sessionId> [--timeout-ms 600000]
 *
 * POSTs analyze {force:true} (redo replaces the old row in place), then polls
 * aireview until a review lands or a terminal job fails. Prints the verdict
 * line and exits non-zero on failure/timeout. Auth: LOCAL_LOGIN_SECRET from .env.
 */
import { readFile } from "node:fs/promises"

const API = process.env.API_BASE ?? "http://localhost:3000"
const sessionId = process.argv[2]
if (!sessionId) throw new Error("usage: review-redo.ts <sessionId>")
const t = process.argv.indexOf("--timeout-ms")
const timeoutMs = t === -1 ? 600_000 : Number(process.argv[t + 1])
const pollMs = 3000

const envText = await readFile(new URL("../.env", import.meta.url), "utf8").catch(() => "")
const secret = /^LOCAL_LOGIN_SECRET=(.+)$/m.exec(envText)?.[1]?.trim()
if (!secret) throw new Error("LOCAL_LOGIN_SECRET missing from .env")
const login = await fetch(`${API}/api/auth/local`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ secret }),
})
if (!login.ok) throw new Error(`local login failed: ${login.status}`)
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] as string
const api = (path: string, init?: RequestInit) =>
  fetch(`${API}${path}`, { ...init, headers: { cookie, "content-type": "application/json" } })

const started = await api(`/api/sessions/${sessionId}/analyze`, {
  method: "POST",
  body: JSON.stringify({ force: true }),
})
if (started.status !== 202)
  throw new Error(`analyze refused: ${started.status} ${await started.text()}`)
const { jobId } = (await started.json()) as { jobId: string }
console.log(`job ${jobId.slice(0, 8)}… started, polling to ${timeoutMs}ms`)

const deadline = Date.now() + timeoutMs
// Wait for THIS job to settle first: aireview still carries the old row until the
// redo replaces it, so reading it early prints a stale verdict.
for (;;) {
  const job = await api(`/api/sessions/${sessionId}/analyze/${jobId}`)
  if (job.ok) {
    const { job: j } = (await job.json()) as {
      job: { status: string; code?: string; detail?: unknown; lastEvent?: { name: string } | null }
    }
    if (j.status === "failed") {
      console.error(`FAILED ${j.code}: ${JSON.stringify(j.detail)?.slice(0, 300)}`)
      process.exit(1)
    }
    if (j.status === "succeeded") break
    if (Date.now() % 15000 < pollMs) console.log(`… ${j.status} ${j.lastEvent?.name ?? ""}`)
  }
  if (Date.now() >= deadline) {
    console.error("TIMEOUT waiting for the review")
    process.exit(2)
  }
  await new Promise((r) => setTimeout(r, pollMs))
}
const res = await api(`/api/sessions/${sessionId}/aireview`)
if (!res.ok) {
  console.error(`aireview missing after success: ${res.status}`)
  process.exit(2)
}
const body = (await res.json()) as {
  review: null | { outcome: string; friction: string; summary: string }
}
if (body.review === null) {
  console.error("job succeeded but no review row landed")
  process.exit(2)
}
console.log(`VERDICT ${body.review.outcome} / ${body.review.friction}`)
console.log(body.review.summary)
