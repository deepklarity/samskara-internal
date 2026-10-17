import { describe, expect, test } from "vitest"
import { validateToolFailureChecklist } from "./checklist-guard.js"
import type { AgentLearning, AiReviewPayload } from "./schema.js"

const timelineLens: AiReviewPayload["lenses"][number] = {
  lens: "timeline",
  entries: [
    {
      id: "exploration",
      kind: "phase",
      title: "Exploration",
      summary: "Initial exploration",
      fromSeq: 0,
      toSeq: 5,
      messageIds: ["msg-0", "msg-1"],
      tracks: ["main"],
    },
  ],
}

const basePayload = (overrides: Partial<AiReviewPayload> = {}): AiReviewPayload => ({
  analyzer: "ai-v1",
  model: "test-model",
  harness: "test-harness",
  outcome: "shipped",
  friction: "none",
  summary: "Test session",
  lenses: [
    timelineLens,
    { lens: "humanLearnings", learnings: [] },
    { lens: "agentLearnings", learnings: [] },
    { lens: "breadcrumbs", learnings: [] },
  ],
  ...overrides,
})

const agentLearning = (overrides: Partial<AgentLearning> = {}): AgentLearning => ({
  title: "Read the test file before editing source",
  detail: "The tests named the exact convention the edit broke.",
  category: "approach" as const,
  audience: "agent" as const,
  severity: 2,
  nextTime: "Read the covering test before editing the source it guards.",
  evidence: [{ seq: 5, messageId: "msg-5", what: "the failing test run" }],
  ...overrides,
})

describe("validateToolFailureChecklist", () => {
  test("passes when toolFailures is 0 (no checklist needed)", () => {
    const result = validateToolFailureChecklist(basePayload(), 0)
    expect(result.ok).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  test("passes when toolFailures > 0 and agentLearnings cites per-tool counts", () => {
    const payload = basePayload({
      lenses: [
        timelineLens,
        { lens: "humanLearnings", learnings: [] },
        {
          lens: "agentLearnings",
          learnings: [
            agentLearning({
              title: "Tool retry pattern",
              detail:
                "The agent retried bash 3 times and edit 1 time instead of reading errors. Per-tool counts: bash=3, edit=1.",
              nextTime:
                "Stop and read the error after the first tool failure; cite per-tool counts from run numbers.",
            }),
          ],
        },
        { lens: "breadcrumbs", learnings: [] },
      ],
    })
    const result = validateToolFailureChecklist(payload, 4)
    expect(result.ok).toBe(true)
  })

  test("passes when toolFailures > 0 and agentLearnings has explicit nothing-entry with reason", () => {
    const payload = basePayload({
      lenses: [
        timelineLens,
        { lens: "humanLearnings", learnings: [] },
        {
          lens: "agentLearnings",
          learnings: [
            {
              ...agentLearning(),
              title: "Nothing to change for the agent",
              detail:
                "Tool failures occurred (bash=2) but were all transient network errors; no process change needed.",
              nextTime: undefined,
              evidence: [],
            },
          ],
        },
        { lens: "breadcrumbs", learnings: [] },
      ],
    })
    const result = validateToolFailureChecklist(payload, 2)
    expect(result.ok).toBe(true)
  })

  test("fails when toolFailures > 0 and agentLearnings is empty", () => {
    const payload = basePayload({
      lenses: [
        timelineLens,
        { lens: "humanLearnings", learnings: [] },
        { lens: "agentLearnings", learnings: [] },
        { lens: "breadcrumbs", learnings: [] },
      ],
    })
    const result = validateToolFailureChecklist(payload, 3)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain(
      "toolFailures=3 but agentLearnings has no tool-failure learning",
    )
  })

  test("fails when toolFailures > 0 and agentLearnings has learning but doesn't cite tool failures", () => {
    const payload = basePayload({
      lenses: [
        timelineLens,
        { lens: "humanLearnings", learnings: [] },
        {
          lens: "agentLearnings",
          learnings: [
            agentLearning({
              title: "Read the test file before editing source",
              detail: "The tests named the exact convention the edit broke.",
              nextTime: "Read the covering test before editing the source it guards.",
            }),
          ],
        },
        { lens: "breadcrumbs", learnings: [] },
      ],
    })
    const result = validateToolFailureChecklist(payload, 2)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain(
      "toolFailures=2 but agentLearnings has no tool-failure learning",
    )
  })

  test("fails when toolFailures > 0 and agentLearnings has nothing-entry without tool-failure reason", () => {
    const payload = basePayload({
      lenses: [
        timelineLens,
        { lens: "humanLearnings", learnings: [] },
        {
          lens: "agentLearnings",
          learnings: [
            {
              ...agentLearning(),
              title: "Nothing to change for the agent",
              detail: "The agent performed well overall.",
              nextTime: undefined,
              evidence: [],
            },
          ],
        },
        { lens: "breadcrumbs", learnings: [] },
      ],
    })
    const result = validateToolFailureChecklist(payload, 1)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain(
      "toolFailures=1 but agentLearnings has no tool-failure learning",
    )
  })

  test("fails when toolFailures > 0 and agentLearnings learning mentions 'tool' but not per-tool counts", () => {
    const payload = basePayload({
      lenses: [
        timelineLens,
        { lens: "humanLearnings", learnings: [] },
        {
          lens: "agentLearnings",
          learnings: [
            agentLearning({
              title: "Tool retry pattern",
              detail: "The agent retried failing tools instead of reading errors.",
              nextTime: "Stop and read the error after the first tool failure.",
            }),
          ],
        },
        { lens: "breadcrumbs", learnings: [] },
      ],
    })
    const result = validateToolFailureChecklist(payload, 2)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain(
      "toolFailures=2 but agentLearnings has no tool-failure learning",
    )
  })

  test("passes when toolFailures > 0 and learning cites per-tool counts with tool names and numbers", () => {
    const payload = basePayload({
      lenses: [
        timelineLens,
        { lens: "humanLearnings", learnings: [] },
        {
          lens: "agentLearnings",
          learnings: [
            agentLearning({
              title: "Bash retry loop",
              detail: "The agent retried bash 2 times (per-tool count from run numbers).",
              nextTime: "Read bash error on first failure; cite run numbers.",
            }),
          ],
        },
        { lens: "breadcrumbs", learnings: [] },
      ],
    })
    const result = validateToolFailureChecklist(payload, 2)
    expect(result.ok).toBe(true)
  })
})
