# AI review — Detailed trace

## 1. CLI entry

**File**: `packages/cli/src/index.ts`
**Function**: `review command()`
**Called by**: `samskara review [sessionId]` argv
**Calls**: `reviewCommand()` in `packages/cli/src/commands/review.ts`

Key logic:
- Flags: `--ai` (harness review + wait), `--json` (raw JSON), `--timeout <ms>`.
- `--ai-review done|missing` is a `search`-only filter, not a `review` flag.
- Parses `recent`/`timeout` to numbers before dispatch.

Data in: argv flags + session id
Data out: options object to `reviewCommand()`

---

## 2. CLI dispatch

**File**: `packages/cli/src/commands/review.ts`
**Function**: `reviewCommand()`
**Called by**: review command in `index.ts`
**Calls**: `reviewAiOne()` when `options.ai === true`, else `reviewOne()`

Key logic:
- Non-AI path is a sync `POST /api/sessions/:id/review`.
- AI path goes through analyze + poll.

Data in: apiBase, token, fetch, options
Data out: printed verdict or JSON; exit code

---

## 3. CLI analyze + poll

**File**: `packages/cli/src/commands/review.ts`
**Function**: `reviewAiOne()`
**Called by**: `reviewCommand()` with `--ai`
**Calls**: `POST /api/sessions/:id/analyze`, `GET /api/sessions/:id/aireview`, `GET /:id/analyze/:jobId`

Key logic:
- `POST analyze` → `202 {jobId}`; `409 analysisAlreadyExists` → `GET aireview` read-back + print; `409 analysisAlreadyRunning` → attach via job poll.
- Error mapping: 404 no session, 403 not editable, 503 busy.
- Polls `GET aireview` every 3s, 600s timeout: `200 {review: null, job}` = running (same as `404 noAiReview`); `200 {review}` → `finishWith()` → `printAiReview()` or raw JSON.
- `--json` gated on `aiReviewHasLenses()` (outcome + friction non-empty, `signals.lenses.length > 0`); else stderr + exit 1.
- Every 15s `GET analyze/:jobId` for `lastEvent {name, at}` progress line.

Data in: session id, analyze choice `{analyzer, harness, model, force}`
Data out: human verdict or review JSON

---

## 4. Analyze route

**File**: `packages/server/src/routes/reviews.ts`
**Function**: `POST /:id/analyze`
**Called by**: CLI `reviewAiOne()` or any `POST analyze` client
**Calls**: `aiReviewJobs.startAiReviewJob()`

Key logic:
- Auth `web|cli`; body `analyzeBodySchema {analyzer: ai-v1|ai-v2, harness: opencode|claude, model, force}` (400 `invalidAnalyzer|Harness|Model|Force`).
- `getDetail` → 404 `sessionNotFound`; `canWrite` → 403 `notEditable`; `activeJobForSession` → 409 `analysisAlreadyRunning`; existing row without `force` → 409 `analysisAlreadyExists`.
- Success → `202 {jobId}`; over 4 concurrent → 503 `busy`.

Data in: `{analyzer, harness, model, force}`
Data out: `202 {jobId}` or error code

---

## 5. Job registry

**File**: `packages/server/src/services/ai-review/jobs.ts`
**Function**: `startAiReviewJob()`
**Called by**: `POST /:id/analyze`
**Calls**: background `runAiReview()`

Key logic:
- In-memory registry, cap 4 concurrent jobs; `jobId = randomUUID`.
- `onMilestone = (name) => recordMilestone(jobId, name)` wired into pipeline.
- Settles `succeeded {reviewId}` / `failed {code, detail}`; restarts lose jobs (job poll then 404 `jobNotFound`).

Data in: session id + analyze choice + milestone callback
Data out: `jobId`; later settled result

---

## 6. Pipeline staging

**File**: `packages/server/src/services/ai-review/pipeline.ts`
**Function**: `runAiReview()` (staging phase)
**Called by**: `startAiReviewJob()` background task
**Calls**: `getDetail`, `getReviewEvidence`/`stageReviewEvidence` (v2), `reviewXmlTemplate[V2]()`, `buildReviewPrompt[V2]()`

Key logic:
- Gates `getDetail`/`canWrite` → `sessionNotFound`/`notEditable`; v2 requires `harness == opencode` else `harnessFailed`.
- `mkdtemp(samskara-ai-review-*)` → `workspace_ready`; v2 also `mkdtemp(samskara-ai-code-*)` + evidence staging → `code_staged`.
- Writes `session.json` (alias `session-under-review`, never the real id), `review.xml` template, `CONTRACT.md`, harness auth → `export_written, template_staged, contract_staged, auth_staged`.

Data in: session detail + evidence
Data out: staged workspace dir + prompt

---

## 7. Harness run

**File**: `packages/server/src/services/ai-review/runner.ts`
**Function**: `runner.run()` (via `createMsbWrappedRunner()` / `createOpencodeRunner()` / `createClaudeRunner()`)
**Called by**: `runAiReview()` after `harness_spawning`
**Calls**: `msb run` / `opencode run` / `claude -p` subprocess

Key logic:
- First stdout byte → `harness_first_byte {firstByteMs}`; process return → `harness_complete`.
- `spawnCollect` caps 2MB; timeout → SIGTERM → SIGKILL after 5s → `HarnessRunnerError {stderr, timedOut, agentLog, logPath}`.
- MSB success reads `~/.microsandbox/sandboxes/<name>/logs/exec.log` → `agentLogFromExecLog`, else stdout tail; failure → `readFailedMsbTrace`.
- Throw → pipeline tries exit-recovery (complete `review.xml` + clean parse + `selfCounts`); else `harness_failed`.

Data in: prompt + workspace dir (+ read-only code dir for v2)
Data out: stdout + `review.xml` deliverable + agent log

---

## 8. XML parse

**File**: `packages/core/src/review/lenses/xml.ts`
**Function**: `parseReviewXml()` / `parseReviewXmlV2()`
**Called by**: `runAiReview()` deliverable phase
**Calls**: `aiReviewPayloadSchema.safeParse()`

Key logic:
- Source: `review.xml` file if changed from template → `deliverable_read {bytes}`; elif `<review` in stdout → legacy stdout fallback; else `deliverableMissing` (+ `deliverable_missing` milestone). Unchanged template + no stdout XML also `deliverableMissing`.
- Heals balancing/escaping/truncation; returns `{ok, value, recovered[], selfCounts?}` or `{ok: false, error, recovered}`.
- Fail → `xml_unparseable` → error `unparseable`. Success → `xml_parsed`; pipeline overwrites `{model, harness}` with runner authority.

Data in: `review.xml` bytes or stdout XML
Data out: schema-valid payload + `recovered[]` + `selfCounts`

---

## 9. Grounding

**File**: `packages/core/src/review/lenses/grounding.ts`
**Function**: `validateGrounding()` (`sessionIndexFrom()` builds the index)
**Called by**: `runAiReview()` after `xml_parsed`
**Calls**: none (pure check)

Key logic:
- Every cited seq/messageId/track must exist in the session index; timeline entries strictly ascending.
- Returns `problems[{path, problem}]` (first 10 persisted on the run).
- Fail → `ungrounded`; success → `grounded`. V2 additionally `validateCodeGroundingV2(payload, evidenceManifest)` for `{repo, path, revision, fromLine/toLine}` citations → fail also `ungrounded`.

Data in: payload + session index (+ evidence manifest for v2)
Data out: `ok` or problem list

---

## 10. Persist

**File**: `packages/server/src/services/ai-review/pipeline.ts`
**Function**: `runAiReview()` (persist phase)
**Called by**: itself after `grounded`
**Calls**: `upsertReview`, `persistLearnings`

Key logic:
- Server-computed `numbers {durationMs, recordCount, toolCallCount, input/output/cached/thinkingTokens}`, timeline `startMs/durationMs`, `run {startedAt, finishedAt, milestones, recovered, selfCounts, xmlBytes, agentLog, transcript, recordIds}`.
- `upsertReview` + `persistLearnings` (human/agent lenses stored as `candidate`) → `persisted` → `{kind: ok, reviewId, payload}`.
- `finally rm workspaceDir/codeDir` — workspaces never survive the run.

Data in: grounded payload + run metadata
Data out: `{kind: ok, reviewId, payload}`

---

## 11. Read-back

**File**: `packages/server/src/routes/reviews.ts`
**Function**: `GET /:id/aireview` (and `GET /:id/analyze/:jobId`)
**Called by**: CLI poll loop, web `fetchAiReview`
**Calls**: `listReviewsForSession`, `activeJobForSession`

Key logic:
- Picks `analyzer == ai-v1` review + active job; both absent → 404 `noAiReview` (pollable "not yet", not a failure).
- Present → `200 {review: null|{id, createdAt, analyzedAt, outcome, friction, summary, signals}, job?{jobId, status, startedAt, lastEvent}}`.
- Job route → `200 {job: {running|succeeded{reviewId}|failed{code, detail}}}` else 404 `jobNotFound` after restart.

Data in: session id (+ job id)
Data out: review and/or job status

---

## 12. Monitor script

**File**: `scripts/ai-review-watch.sh`
**Function**: `main_loop()` (`drain_server`, `drain_exec`, `check_health`)
**Called by**: human in a second terminal alongside `samskara review --ai`
**Calls**: none (reads logs on disk; never starts a review)

Key logic:
- Server stream: `tail` from `$SAMSKARA_SERVER_LOG` (default `/tmp/samskara-server-fresh.log`), regex `milestone":"<name>"` over `workspace_ready … persisted` and failures `harness_failed|xml_unparseable|ungrounded`; `"firstByteMs":N` → first-byte line.
- Sandbox stream: latest `~/.microsandbox/sandboxes/samskara-ai-review-*/logs/exec.log`, JSON `{t,s,d}` stderr `$ ` lines → per-command signature (80 chars, whitespace-squashed), repeat counts.
- Health: `STUCK` when last milestone is `harness_spawning` with no first byte for `$STUCK_AFTER_SECONDS` (default 90s); `THRASHING` when one signature exceeds 5 calls.
- Exit 0 `persisted`, 1 failure milestone, 3 no terminal milestone. `--peek N` dumps last N bash commands (jq preferred, grep fallback) and exits.

Data in: server log path (`-s`), stuck threshold (`-t`), peek lines (`--peek`)
Data out: timestamped terminal stream + final summary + exit code
