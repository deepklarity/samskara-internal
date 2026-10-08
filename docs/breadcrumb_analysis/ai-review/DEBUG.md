# AI review — Debug guide

Claims check: traced by a code-reading subagent against the files below on branch
`pr-29` (2026-10-08). Two items unverified and marked `[?]`: the `invalidSchema`
emit site in the pipeline, and v2 payload fields beyond the head of `v2.ts`.

## Log locations

| Layer | Where | What's in it |
|-------|-------|--------------|
| Server pipeline | `$SAMSKARA_SERVER_LOG` (default `/tmp/samskara-server-fresh.log`) | `milestone":"<name>"` lines, `firstByteMs`, view errors |
| Sandbox agent | `~/.microsandbox/sandboxes/samskara-ai-review-*/logs/exec.log` | every agent tool call as JSON `{t,s,d}`; stderr `$ ` lines are bash commands |
| Harness fallback | stdout tail / `readFailedMsbTrace` output in run record | agent output when `exec.log` is absent |
| Run record | review row `run {milestones, recovered, selfCounts, xmlBytes, agentLog, transcript}` via `GET aireview` | post-hoc milestone + recovery trail |
| CLI | terminal running `samskara review --ai` | poll progress (`still working …`), final verdict or JSON |

## What to search for

| Symptom | Where to look | Search term |
|---------|---------------|-------------|
| Run never produces output | server log | `harness_spawning` with no later `harness_first_byte` |
| Agent stuck or looping | sandbox `exec.log` via `--peek` | repeated bash signature; `THRASHING` in watcher output |
| Review rejected at parse | server log / run record | `xml_unparseable` / `recovered` |
| Review rejected at grounding | server log / run record `problems` | `ungrounded` / `lenses\[` |
| No deliverable written | server log | `deliverable_missing` |
| CLI spins forever | CLI terminal + job route | `still working` / `GET /:id/analyze/:jobId` `lastEvent` |
| 409 on start | CLI output | `analysisAlreadyRunning` / `analysisAlreadyExists` (pass `--force` for the latter) |
| 503 on start | CLI output | `busy` (4-job cap in `jobs.ts`) |
| Job vanished after restart | job route | `jobNotFound` (in-memory registry, expected) |
| `[?]` Unverified code path | pipeline source | `invalidSchema` emit site not found by trace — confirm before citing |

## Quick commands

```bash
# Watch the live run (milestones + agent commands)
scripts/ai-review-watch.sh

# Custom stuck threshold / server log
scripts/ai-review-watch.sh -t 120 -s /path/to/server.log

# Just dump the last 30 agent bash commands and exit
scripts/ai-review-watch.sh --peek 30

# Raw review JSON instead of the human verdict
samskara review <sessionId> --ai --json

# Poll the job directly for lastEvent progress
# GET /api/sessions/<id>/analyze/<jobId>
```

## Env vars that affect this flow

| Variable | Effect | Default |
|----------|--------|---------|
| `SAMSKARA_SERVER_LOG` | Server log path the watcher tails | `/tmp/samskara-server-fresh.log` |
| `HOME` | Locates sandbox logs under `~/.microsandbox/sandboxes/` | — |
| `XDG_DATA_HOME` / `CLAUDE_CONFIG_DIR` | Where staged harness auth is read from | XDG defaults |

## Common breakpoints

- `packages/server/src/services/ai-review/pipeline.ts:runAiReview()` — staging, deliverable, parse, grounding, persist phases
- `packages/server/src/services/ai-review/runner.ts:spawnCollect()` — first-byte timing, output cap, timeout kill chain
- `packages/core/src/review/lenses/xml.ts:parseReviewXml()` — healing + schema validation
- `packages/core/src/review/lenses/grounding.ts:validateGrounding()` — citation existence + ordering
- `packages/server/src/routes/reviews.ts:POST /:id/analyze` — gate rejections (409/503)
