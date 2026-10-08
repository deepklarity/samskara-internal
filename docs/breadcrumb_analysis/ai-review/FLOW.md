# AI review

Trigger: `samskara review <sessionId> --ai` (or `POST /api/sessions/:id/analyze`)
End state: grounded review persisted (`persisted`) and readable via `GET aireview`; failures surface as `harness_failed`, `xml_unparseable`, `ungrounded`, or HTTP 409/503/404 codes

## Flow

packages/cli/src/index.ts :: review command()
  → Parses `--ai`, `--json`, `--timeout`; calls `reviewCommand()`

packages/cli/src/commands/review.ts :: reviewCommand()
  → `options.ai` true → `reviewAiOne()`; else `reviewOne()` (`POST /api/sessions/:id/review`)

packages/cli/src/commands/review.ts :: reviewAiOne()
  → `POST /api/sessions/:id/analyze` → `202 {jobId}`
  → Polls `GET /api/sessions/:id/aireview` every 3s (600s timeout); `GET /:id/analyze/:jobId` every 15s for progress
  → `200 {review}` → prints verdict (human) or raw JSON (`--json`, gated on lenses present)

packages/server/src/routes/reviews.ts :: POST /:id/analyze
  → Validates analyzer/harness/model/force; checks session exists, writable, no active job, no existing review w/o `force`
  → `aiReviewJobs.startAiReviewJob()` → `202 {jobId}` (503 `busy` over 4 concurrent; 409 `analysisAlreadyRunning`/`analysisAlreadyExists`)

packages/server/src/services/ai-review/jobs.ts :: startAiReviewJob()
  → Registers job, wires `onMilestone` → `recordMilestone`; background `runAiReview()` settles `succeeded {reviewId}` / `failed {code,detail}`

packages/server/src/services/ai-review/pipeline.ts :: runAiReview()
  → Gates session/harness; `mkdtemp` workspace → milestone `workspace_ready`; stages `session.json`, `review.xml` template, `CONTRACT.md`, auth → `export_written, template_staged, contract_staged, auth_staged`

packages/server/src/services/ai-review/pipeline.ts :: runAiReview() [harness phase]
  → `harness_spawning` → `runner.run()`; first stdout byte → `harness_first_byte {firstByteMs}`; return → `harness_complete`
  → Throw → exit-recovery attempt; else `harness_failed`

packages/server/src/services/ai-review/runner.ts :: createMsbWrappedRunner() / createOpencodeRunner() / createClaudeRunner()
  → `msb run --name samskara-ai-review-<hex>` (sandbox) or direct `opencode run` / `claude -p`; caps 2MB output; timeout → SIGTERM → SIGKILL
  → Success: `agentLogFromExecLog` (sandbox `exec.log`) else stdout tail; failure: `readFailedMsbTrace`

packages/core/src/review/lenses/xml.ts :: parseReviewXml()
  → Reads `review.xml` (or legacy fenced stdout `<review>`); heals truncation/escaping; validates `aiReviewPayloadSchema`
  → Fail → `xml_unparseable`; success → `xml_parsed` (runner overwrites `{model,harness}`)

packages/core/src/review/lenses/grounding.ts :: validateGrounding()
  → Every cited seq/messageId/track must exist in session index; timeline strictly ascending
  → Fail → `ungrounded`; success → `grounded` (v2 also `validateCodeGroundingV2` against evidence manifest)

packages/server/src/services/ai-review/pipeline.ts :: runAiReview() [persist phase]
  → Computes `numbers`, timeline, `run {milestones, recovered, selfCounts, xmlBytes, agentLog, transcript}` → `upsertReview` + `persistLearnings` (candidate) → `persisted`; `finally rm` workspace

packages/server/src/routes/reviews.ts :: GET /:id/aireview
  → Picks `analyzer==ai-v1` review + active job; both absent → 404 `noAiReview` (pollable "not yet"); else `200 {review, job?}`

packages/web/src/api/review.ts :: fetchAiReview()
  → `GET aireview` → `{review, job}`; 404 `noAiReview` → `{review: null, job: null}`

scripts/ai-review-watch.sh :: main_loop()
  → Tails server log for `milestone":"<name>"` + `firstByteMs`; tails latest `samskara-ai-review-*/logs/exec.log` bash calls
  → Flags `STUCK` (no first byte >90s), `THRASHING` (same command >5x); exit 0 `persisted`, 1 failure, 3 no-terminal
