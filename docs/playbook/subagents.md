# Subagents: parallel by default, cheapest capable model

The full rule for how a main session delegates. `CLAUDE.md` carries the summary; this page is the detail it points at.

**This section applies ONLY to the top-level (main) conversation. If you are a subagent, launched via the Agent tool to do a specific task, it does not apply to you: do the assigned work directly with your own tools and NEVER spawn further subagents.** (This file is loaded by every agent; without this guard, subagents recursively delegate.)

**Always pass `model:` explicitly.** An omitted `model:` inherits the expensive top-tier model.

| Work | Agent + model |
|---|---|
| Exploration / search / read | `Explore`, **haiku** |
| Implementation | `general-purpose`, **sonnet** |
| Planning / architecture | `Plan`, **opus** (never downgrade) |

**The main conversation is a coordinator, not a worker.** Every file read, search, or code exploration done directly in the main conversation burns expensive opus tokens. Default to delegating data-gathering and mechanical work to subagents, and reserve the main context window for synthesis, judgment, and decisions.

**Parallel is the default, sequential is the exception.** Whenever you have 2+ independent subagent tasks, launch them in a single message with multiple Task tool calls. Do not wait for one subagent's result before launching another unless the second genuinely depends on the first's output. Sequential subagent dispatches for independent work is a performance anti-pattern — it turns a 30-second parallel fan-out into a 3-minute serial chain.

**The rule of thumb**: If you're about to spawn a subagent, ask "is there another subagent I should spawn at the same time?" If yes, batch them into one message. This applies to planning, exploration, implementation, and verification phases equally.

**Non-negotiable model assignments (NEVER override):**
- **Plan subagents → always opus.** NEVER use sonnet or haiku for `subagent_type: Plan`. Planning, architectural analysis, and trade-off evaluation require the strongest model. This is a hard constraint, not a suggestion. When using EnterPlanMode or spawning a Plan agent via the Task tool, always set `model: "opus"` explicitly.
- **Explore / read / search subagents → always haiku.** File searches, glob/grep, reading files, summarizing structure — always haiku. No exceptions.

When spawning subagents via the Task tool, choose the cheapest capable model:

- **Haiku** — Exploration and mechanical tasks: file searches, grep/glob lookups, reading files and summarizing their structure/exports, checking what conventions a directory follows, finding all usages of a function, formatting checks, running a single well-defined command, creating a file from a clear template, adding imports. Use when the task has a discoverable answer or a clear specification.
- **Sonnet** — Judgment-requiring tasks: writing code that must follow existing patterns, multi-file refactoring with clear targets, writing tests for existing code, code reviews, researching a focused question that requires cross-referencing several files. Use when the task needs reasoning but the patterns are established.
- **Opus** — High-complexity tasks: architectural decisions, debugging subtle cross-system issues, designing new abstractions, writing code that requires understanding multiple interacting systems, ambiguous requirements that need creative problem-solving.

**Escalation protocol** (applies to sonnet/haiku decisions only — Plan is always opus, Explore is always haiku): Start with the cheapest model that can plausibly handle the task. If a haiku agent returns a shallow or incomplete result, re-run with sonnet — don't pre-emptively use a heavier model "just in case." If sonnet misses nuance, escalate to opus. Most exploration is haiku-tier. Most implementation is sonnet-tier. Reserve opus for tasks where getting it wrong would cost more than the model price difference.

### When to delegate vs. do directly

**Delegate to subagents** (the default for most work):
- "What files handle X?" / "How is Y structured?" / "What pattern does Z follow?" → haiku explorer
- "Read these 3 files and summarize the interface contract" → haiku
- "Find all places where function X is called and list the call signatures" → haiku
- "Write this test / create this file / add this import" (clear spec, no ambiguity) → haiku
- "Write this component following the pattern in ComponentX" → sonnet
- "Refactor module X to extract Y" → sonnet

**Do directly in main conversation** (when you need the content for an imminent decision):
- You're about to make an architectural choice and need to see the code yourself
- The answer will immediately feed into a judgment call in the next sentence
- You've already delegated and need to verify/synthesize subagent results
- A quick single-file read (< 100 lines) that's faster than spawning a subagent

**Anti-patterns**:
- Reading 5+ files sequentially in the main conversation to "understand the codebase" before writing code. Instead, spawn parallel haiku explorers for each area, synthesize their summaries, then make decisions.
- Spawning one subagent, waiting for its result, then spawning the next independent subagent. If the tasks are independent, they go in one message.
- Running backend tests, waiting, then running frontend tests. Independent test suites run in parallel.

### Plan mode — Parallel exploration, then synthesize

**Judgment stays in the main conversation; data gathering is delegated.** The main opus conversation owns all architectural thinking, trade-off analysis, and plan authorship. But factual research — finding files, reading code structure, checking conventions, discovering what exists — should be delegated to subagents to conserve the main context window.

**Planning follows a fan-out → synthesize → decide pattern:**

1. **Fan-out (one message, multiple parallel subagents):** Identify all areas of the codebase you need to understand and launch haiku/sonnet explorers for each in a single message. Don't read one area, then decide to read another — anticipate what you'll need and launch all explorers at once.

2. **Synthesize:** When all subagent results return, cross-reference their summaries in the main conversation. This is where opus earns its cost — connecting findings across areas.

3. **Decide:** Write the plan based on synthesized understanding.

**Example — planning a feature that touches models, serializers, and frontend:**
```
Single message with 3 parallel subagents:
  → haiku: "Find all model files in the backend, list fields and relationships"
  → haiku: "What serializers exist? List their fields and any custom logic"
  → haiku: "Read the frontend types and API service files, summarize the data contract"
Wait for all 3 → synthesize → write plan
```

**NOT this** (sequential anti-pattern):
```
→ haiku: "Find model files" → wait → read result
→ haiku: "Now find serializers" → wait → read result
→ haiku: "Now check frontend" → wait → read result
→ finally write plan (3x slower, same result)
```

- **Delegate (haiku)**: "Find all model files in <backend folder> and list their fields", "What serializers exist and what do they expose?", "Read orchestrator.py and summarize the public API"
- **Delegate (sonnet)**: "Analyze how the harness registry pattern works across 4 files and describe the contract", "Review the test structure and identify what's covered vs. gaps"
- **Keep in main conversation**: Synthesizing subagent findings into an architectural decision, choosing between approaches, writing the actual plan, resolving conflicting patterns

### Implementation mode — Test-First Wave Execution

When executing a plan, **enforce TDD through scope-isolated subagent dispatches.** The key constraint: the test-writing subagent never receives implementation details, and the implementation subagent doesn't start until failing tests exist on disk.

**Why scope isolation, not instructions:** Telling an agent "write tests first" in the same context as implementation details reliably fails — the LLM's prior toward "build the thing" overrides procedural instructions. The fix is structural: the test-writing agent *cannot* write implementation because it doesn't have implementation context. The implementation agent *cannot* skip tests because it literally runs after them.

**The test-first wave pattern:**

1. **Wave 0 — Scenario matrix** (main conversation): List happy paths, edge cases, failure modes. This is the test spec. No implementation design yet.

2. **Wave 1 — Tests only** (subagent, sonnet): Dispatch a subagent whose ONLY job is writing tests. Its prompt contains:
   - The scenario matrix from Wave 0
   - Existing test patterns/conventions (discovered by a haiku explorer)
   - The *behavioral requirements* (what the feature should do)
   - **NOT** how to implement it (no model designs, no serializer details, no view logic)

   The subagent writes test files and returns. Nothing else.

3. **Gate — Run tests, confirm they fail** (main conversation): Execute the test suite. Every new test must fail. If a test passes before implementation exists, it's a false positive — fix or delete it. This gate is mandatory. Do not proceed to Wave 2 until failing tests are confirmed.

4. **Wave 2 — Implementation** (subagents, sonnet/haiku): Now dispatch implementation subagents. They receive:
   - The failing test files (so they know what to satisfy)
   - The behavioral requirements
   - Implementation context (existing models, patterns, etc.)

   **Maximize parallelism within the wave.** Launch all implementation subagents that touch different files in a single message. Only serialize steps that have true data dependencies (e.g., model must exist before serializer can reference it). Within a wave, the default is parallel — sequential is the exception.

5. **Wave 3 — Verify** (main conversation or haiku): Run the full test suite. All tests must pass. Then verify live.

**Example — adding a new feature with model + serializer + view + test:**
```
Wave 0 (main):           Scenario matrix — 3 happy paths, 2 edge cases, 2 error cases
Wave 1 (sonnet):         Write test file with 7 test cases (receives requirements ONLY, no impl details)
Gate:                    Run tests → 7 failures confirmed
Wave 2a (single message, parallel subagents):
  → sonnet: Create model + migration
  → sonnet: Write URL routing (can be done without model)
  → haiku:  Add frontend type definitions
Wave 2b (after 2a completes — depends on model):
  → sonnet: Write serializer + view (reads model from 2a)
Gate:                    Run tests → 7 passes confirmed
Wave 3 (haiku):          Verify live
```

**Maximize wave parallelism by analyzing dependencies.** Before dispatching a wave, map out which steps depend on which. Steps with no dependencies on each other go in the same message as parallel subagents. Steps that depend on prior outputs go in the next sequential wave. The goal is the fewest sequential waves with the most parallelism within each.

**The information boundary is the enforcement.** Wave 1's subagent literally cannot produce implementation code because it wasn't given implementation context. This is not a suggestion — it's a structural constraint.

**When NOT to wave**: If the task is a single-file change, a bug fix requiring investigation, or anything where the steps are inherently sequential — just do it directly. Waving a 2-step task adds overhead without benefit.

**Conflict prevention**: Never put two steps that modify the same file in the same wave. If in doubt, make it sequential. The cost of a merge conflict far exceeds the cost of a sequential step.

---

## Model lanes on this machine (herdr / opencode)

Reference for pinning a model when dispatching a subagent (harness Task tool or a Herdr
opencode pane). Test evidence and quota lore live here; CLAUDE.md and AGENTS.md only point
here. Re-verify anything marked untested with the hello-world probe below before building a
flow on it.

## The one rule

**A model is set when the agent starts, by flag — never by asking the agent to switch.**
`/model` is a TUI action; an agent cannot perform it and will stall on the picker.

```bash
herdr agent start audit --kind opencode --pane "$PANE" -- --model <provider/model>
```

Verify what the agent actually got with `herdr agent read <name> --source visible` — the
status line names the model.

## Lane order (use the first lane that has quota)

1. **OpenCode Zen free models** — ~200 requests/day **per model** per IP/account, reset
   00:00 UTC. Rotate to another free model when one 429s (`FreeUsageLimitError`, no warning).
   Paid Zen balance does **not** bypass free-model quota.
2. **`minimax-coding-plan/MiniMax-M3`** — coding plan, no Zen quota. Use as the independent
   second lane, or as fallback when all free lanes are dry.
3. **`zai-coding-plan/glm-5.3`** (non-flash) — coding plan, effectively unbounded. Last
   resort on this machine: it carries the owner's main paid lane; don't spend it on
   exploration or mechanical work.

## OpenCode Zen free models — tested 2026-10-13

| Model ID | Status | Speed | Intelligence | Plan | Notes |
|---|---|---|---|---|---|
| `opencode/nemotron-3-ultra-free` | ✅ | ●●●○○ | ●●●●● free | free | Best free reasoning; 1M ctx. Default for judgment/audit lanes. |
| `opencode/nemotron-3.5-lightning-free` | ✅ | ●●●●● | ●●●○○ free | free | 30B, fastest good option. Default for mechanical lanes. |
| `opencode/muse-spark-1.3-contributor-free` | ✅ | ●●●●○ | ●●●○○ free | free | Contributor tier; has hit quota by evening before. |
| `opencode/longcat-2.5-preview-free` | ✅ | ●●●○○ | ●●●●○ free | free | Multimodal (image), 1M ctx, 131K out. |
| `opencode/space-bunny-free` | ✅ | ●●●●○ | ●●●○○ free | free | One lane observed dead once; re-probe before relying on it. |
| `opencode/mimo-v2.6-flash-free` | ✅ | ●●○○○ | ●●○○○ free | free | Slowest working lane. |
| `opencode/ling-3.1-flash-free` | ✅ | ●●●●○ | ●●●○○ free | free | |
| `opencode/ling-3.0-flash-fin-free` | ⏱ | — | — | free | Timed out on probe. |
| `opencode/step-5-preview-free` | ⚠️ | ●●●●○ | — | free | Banner only, no response text. |
| `minimax-coding-plan/MiniMax-M3` | ✅ | ●●●○○ | ●●●●○ paid | paid | Independent second opinion; no shared quota with Zen. |
| `zai-coding-plan/glm-5.3` | ✅ | ●●●○○ | ●●●●● paid | paid | Effectively unbounded; spends the owner's paid lane — last resort. |
| `glm-5.3-flash` / `zai-coding-plan/glm-5.3-flash` | ❌ | — | — | paid | Server-side `UnknownError` on every request here. |
| `opencode/exo-free` | ❌ | — | — | free | Deprecated. |

Also avoid `minimax-coding-plan/MiniMax-M3.1-Flash-Preview` (unusable). Untested: `opencode/big-pickle`, `opencode-go/*` — often rate-limited per GitHub issues.

## Role → model

| Role | Pick | Reason |
|---|---|---|
| Default dispatch (exploration, implementation, tests) | `opencode/nemotron-3.5-lightning-free` | Fast, good quality, free quota |
| Judgment / synthesis / planning | `opencode/nemotron-3-ultra-free` | Best free reasoning, 1M ctx |
| Quick mechanical edits after the good lane is dry | `muse-spark-…-free`, then `space-bunny-free`, `ling-3.1-flash-free` | Rotate past 429 |
| Independent second opinion / second parallel lane | `minimax-coding-plan/MiniMax-M3` | Genuinely different lineage, no shared quota |
| Overflow when everything above is exhausted | `zai-coding-plan/glm-5.3` | Unbounded but spends the paid lane |

## Probe a model before relying on it

```bash
opencode -m <provider/model> -p "Write a one-line Python hello world. Just the code, nothing else."
```

Or live in a throwaway Herdr pane (close it after):

```bash
herdr pane split --current --direction right --cwd "$PWD" --no-focus   # note pane id
herdr agent start probe --kind opencode --pane <pane-id> -- --model <provider/model>
herdr agent prompt probe "say hello" --wait --timeout 60000
herdr pane read <pane-id> --source recent-unwrapped --lines 20
herdr pane close <pane-id>
```

A 429 `FreeUsageLimitError` means quota, not breakage — retry after 00:00 UTC or rotate.
Timeouts and empty banners on two consecutive probes mean the model is unusable; record the
result in this file's table.

---
*Source: `writeup/ai-review/models/` (opencode-models.md, model-comparison.md), merged into this page 2026-10-13; the writeup folder is deleted.*

