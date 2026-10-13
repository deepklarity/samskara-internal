# Samskara

Bun + Turborepo monorepo. Packages: `core` (ingest/domain), `server` (Hono + Drizzle + Postgres),
`web` (React + Vite), `cli`. Tests are vitest; lint/format is biome. TDD — write the test first.
This file is the entry point for every agent and human, on every harness. `AGENTS.md` just
points here.

## Read before you act

Before the action in the left column, open the file on the right. That is how a rule is
never missed.

| About to | Open |
|---|---|
| Dispatch any subagent | **Agent delegation**, below — then `docs/playbook/subagents.md` for the model |
| Control Herdr (panes, tabs, other agents) | `.claude/skills/herdr/SKILL.md` — read it before any `herdr` command |
| Resume or update an initiative | `writeup/<initiative>/RESUME.md` first, `board.csv` wins on disagreement |
| Debug a flow or ask "how does X work" | `docs/breadcrumb_analysis/_INDEX.md` — trace, don't guess |
| Capture a reusable learning | `docs/patterns/` — append, never fork |
| Run or write tests | `docs/testing_process/`, plus the TDD convention below |
| Run the app, CLI or web UI | `README.md` |
| Understand why the repo exists | `docs/project_understanding.md` |

One fact lives in one place. When docs and reality diverge, fix the doc that is wrong —
don't add a second copy that says something else.

## Agent delegation — parallel by default

**The main conversation is a coordinator, not a worker.** Reserve it for synthesis,
judgment, decisions, and verification; delegate data-gathering, exploration, and
well-specified implementation. Independent dispatches go out in one batch — sequential
fan-out of independent work is the anti-pattern in every phase (exploration, planning,
implementation, verification).

- **Delegate**: "how does X work", file/area surveys, pattern discovery, writing tests to
  a spec, implementing a well-scoped change. **Do directly**: anything whose output feeds
  the very next judgment call, and single quick reads.
- **Subagent guard.** If you are yourself a subagent, do the assigned work directly and
  never spawn further subagents — this file is loaded by every agent, and without this
  guard delegation recurses.

### Two dispatch mechanisms — route by the shape of the work

- **Harness-native Task tool — the default.** Bounded work that fits one prompt and
  returns one answer: exploration, surveys, research, test-writing waves, spec'd
  implementation chunks. Fire-and-forget, batched in parallel, nothing to clean up.
- **Herdr-spawned panes — for work with a lifespan or an audience.** Long builds the
  owner should be able to watch or join mid-run (takeover), cross-model deliberation,
  lanes that must outlive the current session or take sequential briefings, and anything
  likely to need interactive unblocking — a live pane can be read, re-prompted, and have
  its questions answered in place.

Detect the environment once with `test "${HERDR_ENV:-}" = 1`. Inside Herdr, long-lifespan
work goes to a sibling pane; outside Herdr everything routes through the Task tool — the
shape rule still applies, the pane lane just isn't available.

### The Herdr dispatch loop

**Layout: tabs, not panes.** Each dispatched agent gets its **own tab** (`herdr tab
create`, then start the agent in the tab's root pane) — the owner's main view stays on
this conversation. Never side-by-side panes by default. The only exception: work the
owner should watch live gets **one** vertical split, never more.

```bash
# 1. a fresh tab per agent, same cwd
herdr tab create --cwd "$PWD"          # note .result.tab and .result.root_pane
# 2. start the agent in the tab's root pane, pinning the model — never later, never
#    by asking it to switch
herdr agent start impl-1 --kind opencode --pane "$PANE" -- \
  --model opencode/nemotron-3.5-lightning-free
# 3. brief it (worktrees: never tell it to create one — branch in place)
herdr agent prompt impl-1 "<self-contained brief: files, spec, test command, done-criteria>"
# 4. poll — an idle agent with an empty buffer means the prompt never landed: re-prompt.
herdr agent wait impl-1 --timeout 600000   # then verify with agent read / agent list
herdr agent read impl-1 --source visible   # its output, not its summary
# 5. close what you opened when its work is done
herdr tab close "$TAB"
```

- **Pin the model at start.** `--model` is a start flag; `/model` is a TUI action the
  agent cannot perform and will stall on. Lane order and quota lore:
  `docs/playbook/subagents.md`. Verify the pinned model took: `herdr agent read <name>
  --source visible` — the status line names it.
- **The brief is self-contained.** An agent pane sees nothing of your context: name the
  files, the spec, the exact test/lint command, and what done looks like. It must never
  create git worktrees, restart the dev stack mid-review, or run the full suite while
  another agent holds it (see coordination note below).
- **Trust, then verify.** Delegation on this machine has a failure mode: agents have
  opened stale foreign contexts and left half-finished files (2026-10-12, log.md). So:
  never merge an agent's self-reported "done" — run the scoped tests yourself in this
  thread, and for UI work screenshot the real page; green tests are not proof the page
  renders. Prefer dispatches whose done-criteria you can check mechanically.
- **Coordination on one checkout.** With more than two agents writing code: one writer
  per file, say which files each lane owns in its brief, and only one full suite at a
  time. Commit or stash between waves so a bad lane is revertible.
- **Hygiene.** Number tabs you create (`1 …`, `2 …`) as breadcrumbs, and **close what
  you opened** when its work is done — tabs and panes you made, not the user's.
  Long-running shared infrastructure (the dev stack) is the exception: it stays until
  the owner says stop.

### Test-first waves for TDD

When a task is big enough to wave: one subagent writes the failing tests (given
requirements and patterns, no implementation context), the gate runs them red, then
implementation subagents receive the failing tests. The information boundary is the
enforcement — that is why the dispatches are separate. Small or inherently sequential
tasks skip the wave and just do TDD inline.

## Durable state — the disk is the memory

Sessions compact and end; anything that must survive belongs in a file.

- **Each initiative gets `writeup/<initiative>/`**: `RESUME.md` (machine entry point),
  `board.csv` (task state — wins over RESUME on disagreement), `log.md` (append-only,
  one entry per session), and the rendered page. Update as you go, not at the end — a
  tracker that lags the work is a bug. On "resume", read the tracker before acting.
- **Breadcrumbs** for traced flows: `docs/breadcrumb_analysis/` (index:
  `_INDEX.md`). **Compounded patterns**: `docs/patterns/`. Both are cross-initiative;
  `writeup/` is per-initiative and never the home for reusable reference — promote
  anything reusable into `docs/` (see `docs/playbook/subagents.md` for the pattern).
- No `MEMORY.md` files. Persistent context lives in this file, `docs/`, or the tracker.

## Commands that must not block the session

**Foreground calls finish in seconds; never wait inside one.** No wait loops, no long
timeouts on a foreground call — while one runs, the owner's messages cannot reach the
session. Anything over about a minute (full suites, live reviews, migrations) runs
backgrounded or in a subagent, writing to a log you check with two numbers: the log's
last line and its age. No new output for ~3 minutes means stuck — find what it waits on,
then kill it. Long ops are debugged by watching progress, not by waiting out a timeout:
the milestone rules under "Long-running operations" below are mandatory reading before
kicking one off.

## Coding conventions

- **Simplicity is a feature.** Between two correct approaches pick the one with fewer
  moving parts. Abstraction layers and extensibility points are costs needing justification.
- **Solve the actual problem.** Don't generalize from one instance. If the code feels
  awkward, question the data model — the right fix is usually upstream of the symptom.
- **No slop.** Generated code meets the hand-written bar: no filler comments, no
  defensive boilerplate for impossible cases. Match surrounding naming and idiom.
- **Methodical debugging.** Observe before acting; read the actual error. State the
  hypothesis ("X because Y; changing Z should fix it because W"), change one thing at a
  time, and if a fix fails twice the diagnosis is wrong: zoom out. Breadcrumb first.
- **TDD**: test first for behavior changes; tests survive refactors — test behavior,
  not implementation shape.

## New machine

```bash
bun run setup YOUR_GITHUB_ORG_SLUG
bun run dev
```

`setup` installs, writes `.env` with a generated `JWT_SECRET`, starts Postgres, migrates, seeds and
registers the org. It stops on the first run to have you paste the GitHub OAuth client id and
secret into `.env` — the only manual step. Re-running is safe: it never rotates a secret that is
already set and leaves a database that already has projects alone. Worktrees additionally need
`brew install worktrunk && wt config shell install`.

`.env` is gitignored, so nothing here is shared between machines: ports and database names are all
derived locally.

## Worktrees

**Always create worktrees with the `create-worktree` skill, never with `git worktree add` and never
with the harness `using-git-worktrees` skill.**

`wt` (worktrunk) drives creation, and `.config/wt.toml` hooks give each worktree its own Postgres
database and its own port pair. That isolation is the whole point: every branch shares one Postgres
container, so without a per-branch database a migration on one branch rewrites the schema every
other branch is reading, and two branches cannot run the app at once.

The rule that matters: **`.env` must be a real file in each worktree, never a symlink to the main
checkout's `.env`.** A symlink means one `DATABASE_URL` for every branch, and editing it in a
worktree silently edits the main checkout. `bun run wt:setup` replaces a symlink with a copy.

| Command | What it does |
|---|---|
| `wt switch --create feat/thing` | Creates the worktree and runs the hooks (copy env, install, per-branch db, migrate, seed) |
| `wt list` | Worktrees and their status |
| `wt remove` | Removes the worktree; the `pre-remove` hook drops its database |
| `bun run wt:setup` | Re-runs env + database setup for the current worktree (idempotent) |
| `bun run wt:teardown` | Drops only the current worktree's database |

Only `.env` crosses over from the main checkout: `.worktreeinclude` is an allowlist and a file must
be both gitignored and listed there. `node_modules`, `dist` and `.turbo` are rebuilt per worktree,
Where worktrees land is a personal setting
(`worktree-path` in `~/.config/worktrunk/config.toml`), so do not assume `.worktrees/`; read
`git worktree list` instead.

Each worktree's `.env` records `WT_SLUG` and `WT_PORT_OFFSET`. The offset is derived from the branch
name, so ports are stable across runs; server is `3000 + offset`, web is `8000 + offset`. Run
`bun run wt:setup` and it prints the db url, api url and web url for the current worktree.

**Logging in inside a worktree.** You do not log in again — you reuse the session you already have.
Cookies are not scoped by port, so the `session` cookie set at `localhost:8000` is sent to
`localhost:8252` too, and every worktree copies `.env` so `JWT_SECRET` matches. The only thing that
used to break was the lookup in `requireAuth`: the JWT carries your user's uuid as `sub`, and the
worktree's fresh database had no such row.

`.seed/identity.json` fixes that. It is a snapshot of this machine's users, orgs and memberships,
written by `bun run seed:capture` (and by `bun run setup`, once you have signed in). `bun run seed`
restores it **keeping the same uuid** and grants the restored users admin on the demo project. A
generated uuid would not do — it would authenticate as nobody.

The file is gitignored: it holds real uuids and emails, and a uuid is only meaningful on the machine
that generated it. `.worktreeinclude` lists `.seed/`, so worktrunk copies it into every new worktree
alongside `.env` — which is why the seed needs no source database, no environment variable and no
knowledge of the main checkout.

JSON rather than SQL on purpose: it stores TypeScript property names (`githubId`), and Drizzle turns
those into whatever the branch's schema currently calls that column. A `.sql` dump bakes in
`github_id` and breaks on the first branch that renames it — which is precisely the situation
worktrees create.

If a restore warns that the id was not preserved, the target database already held that GitHub id
under a different uuid.

What still does not work in a worktree is the GitHub round trip itself: clicking "Sign in" sends
`redirect_uri=http://localhost:PORT/...` and a GitHub OAuth app matches host *and port* exactly
against its one registered callback (`http://localhost:3000`). So sign in on the main checkout at
`http://localhost:8000`, then open the worktree — you are already in.

## Database

One Postgres container (`docker compose -p samskara up -d`) on port 5433, many databases inside it.
Main checkout uses `samskara`; a worktree uses `samskara_BRANCH_SLUG`.

No Docker on the machine? `scripts/local-pg.sh start` runs a dedicated local PostgreSQL cluster
on the same port 5433 with the same role, database and `DATABASE_URL`, using the Homebrew
PostgreSQL binaries. Only one of the two can own port 5433 at a time — stop the other before
switching (`scripts/local-pg.sh stop` / `bun run stack:down`). The schema needs no extensions
today, so plain PostgreSQL is enough; `recreate` drops and rebuilds the cluster from migrations.

- `bun run db:generate` — generate a migration from `packages/server/src/db/schema.ts`
- `bun run db:migrate` — the only way to bring a database up to date: drizzle-kit's migrations, then every step in `packages/server/src/db/steps.ts`, against whatever `DATABASE_URL` the local `.env` names
- `bun run db:verify` — read-only check that every step is already converged
- `bun run seed` — idempotent dev fixture: dev user, org, project, 3 sessions, then restores `.seed/identity.json` if it is there. `--from FILE` reads a different snapshot; `--if-empty` makes it a no-op when the database already has projects, which is how `setup` stays safe to re-run
- `bun run seed:capture` — write `.seed/identity.json` from the current database. `--to FILE` writes elsewhere. Writes nothing when no real user has signed in yet
- `bun run seed:org ORG_SLUG` — register a real GitHub org, and the only path that works before
  anyone has signed in. Re-running it writes `autoAddMembers` from the flag you passed, so it is
  also how you change that setting from a shell
- A signed-in super admin registers further orgs from the web UI at `/orgs`. That path deliberately
  does **not** touch an org that already exists: re-registering a slug to fix a typo must not reopen
  automatic membership for everyone in that GitHub org

**Post-migrate steps.** Some database work cannot live in a migration: `create index
concurrently` is rejected inside a migration's transaction, so the full-text search indexes are
built outside the migration journal. `db:migrate` runs drizzle-kit and then every step registered
in `MIGRATION_STEPS` (`packages/server/src/db/steps.ts`), under one advisory lock. Never migrate a
database any other way — a setup path that runs only `drizzle-kit migrate` yields a schema-correct
database with no search indexes, and search then scans and re-tokenizes all of `messages` on every
query, which looks like a hang rather than a missing step.

A step is a module beside `steps.ts` exporting `{ name, run, verify }`. `run` converges and must be
idempotent, because it runs on every migrate including ones with no new migrations; `verify` only
reads, and backs `db:verify`.

`drizzle.config.ts` has no default `DATABASE_URL`. If it is unset the migration fails loudly rather
than quietly migrating the main checkout's database.

**Column naming.** Every table and column name is camelCase. A Biome plugin
(`packages/server/src/db/naming.grit`) enforces it against `packages/server/src/db/schema.ts`, so
`bun run lint` fails on a snake_case name. The plugin reads TypeScript, not SQL, so a hand-written
migration that adds a column without touching `schema.ts` is not checked — keep `schema.ts` the
source of truth and generate migrations from it.

The server's test suite starts a real `pgvector/pgvector:pg16` container via testcontainers and runs
the migrations against it. Those tests skip themselves when Docker is not available.

## Message transformers

A client can be wrong about what it uploads — an older CLI missing a field a newer one sets. Fixing
only the reader leaves every already-installed client still uploading the old shape, so the
correction also runs server-side, in `MESSAGE_TRANSFORMERS`
(`packages/server/src/services/messageTransformers.ts`). `ingest()`
(`packages/server/src/services/ingest.ts`) runs the list on every arriving message before a row is
built, and logs how many messages each entry changed in the `transformed` field of the "Ingestion
completed" line — that count is how you tell whether a transformer still fires.

A transformer may only fill in a value the client left unset, never overwrite one it sent, and
returns its input unchanged when it doesn't apply — so leaving one registered after it stops being
needed costs nothing but a reference comparison. Each entry's own docblock says the condition for
deleting it (typically: this count reads zero across a full release, meaning every client now sets
the value itself); retiring one is removing its entry from the list and nothing else.

Rows already stored before a fix ships need a separate migration — a transformer only ever sees a
message once, on the way in.

## Logging

Every package logs NDJSON through `createLogger` from `@samskara/core` (pino underneath). Level
comes from `LOG_LEVEL`, defaulting to `info` in production and `debug` elsewhere. `token`,
`authorization`, `password` and `secret` are redacted from every line. Each API request gets a
`reqId` that is echoed back on the response.

## Hot reloads kill running reviews — check first

`tsx watch` restarts the server whenever `packages/server/src/**` (or a rebuilt dependency's
dist) changes, and the AI-review job registry is in-memory: **every restart silently kills any
running review**, and `tsx watch` does not re-read `.env` on reload (env vars need a full
restart). Before editing server files, rebuilding a package, or changing `.env`, check whether
a review is in flight — `curl -s localhost:3000/api/sessions/:id/aireview` returns `"job"` while
one runs, or ask the owner. Batch your edits, and never restart mid-run when avoidable.

## Long-running operations: progress before timeout

Anything that takes more than a few seconds — a harness run, a watcher sweep, a large migration,
a long curl chain — is debugged by **watching it move**, not by waiting on a timeout. The rule:

1. **Define the observable signals up front, before the run.** For an LLM-backed pipeline:
   - `export_written` (with byte count, workspace path)
   - `harness_spawning` / `harness_spawned` (with the command line + sandbox id)
   - `harness_first_byte` (the ms from spawn to the first stdout byte — the single best
     "is it alive?" signal)
   - `xml_parsed` / `grounded` / `persisted` (each at a phase boundary)
   Each milestone logs `{ milestone, elapsedMs, sessionId }` via `createLogger` so the server
   log is grep-able, and is also exposed through any "current state" API so a CLI client can
   render progress without tailing the log.

2. **The CLI surfaces the latest milestone on a cadence (15–30 s is usually right).** A
   watching human should be able to read "still working (job abc…, harness_first_byte 4 s
   ago, 62 s total)" and tell from that one line whether the run is healthy, stuck, or
   mid-failure. Never let a long op look frozen.

3. **Smoke-test on the smallest input first.** A 5-message session, a 1-record artifact, a
   one-row migration — the fastest thing that still exercises every layer. Scale up only
   after the small one passes cleanly; otherwise the long op doubles as your only signal.

4. **Log the names of the things a watcher would want to tail.** Workspace path, sandbox id,
   log file path inside the sandbox. Anyone debugging should be able to `ls`, `msb logs`, or
   `tail -f` without rummaging through the server source.

5. **Timeout messages name the last milestone.** When the wall clock trips, the message
   includes the latest server event so the next person knows where the run got stuck, not
   just that it stopped.

### Watching a live AI-review run

Pipeline milestones cover the server-side view; what the reviewer agent itself is doing
inside the msb VM lives in the sandbox's `exec.log` (one JSON line per stderr/stdout event,
the agent's bash prompts appear as `"d":"\u001b[0m$ \u001b[0m<cmd>"`). The repo ships a
companion tool for that — the AI-review watcher — that reads both streams in parallel,
counts repetitions, and flags stuck / thrashing patterns in real time:

```sh
# in one terminal: kick off the review
SAMSKARA_API_URL=http://localhost:3000 \
  bun packages/cli/src/index.ts review <session-id> --ai --timeout 540000

# in another terminal: watch it
scripts/ai-review-watch.sh                # tail milestones + flag stuck (default 90 s)
scripts/ai-review-watch.sh -t 30          # tighter stuck threshold for small sessions
scripts/ai-review-watch.sh --peek 30      # one-shot: dump the agent's last 30 bash calls
```

The watcher prints each milestone (`milestone harness_first_byte`), each new bash command
the agent runs (with a `REPEAT(n)` tag once n > 3 and a `THRASHING` warning past 5), and an
explicit `STUCK` line if `harness_spawning` is the last milestone for longer than the
threshold — at which point it tells you to `peek`. Run it any time you would have written a
`sleep 30; grep ...` loop in the shell.

## Releases

Every package carries the same version. Never hand-edit a `version` field:
`bun run release:version patch|minor|major|1.4.0` writes all five and tags the commit, and pushing
that tag is what releases. The README's "Releases" section has the rest, including why the CLI
tarball bundles core the way it does.

`scripts/` is tested by `bun test`, not vitest. Run it with `bun run test:scripts` — a bare
`bun test scripts/` also matches `packages/server/src/scripts/*.test.ts` and starts real Postgres
containers.
