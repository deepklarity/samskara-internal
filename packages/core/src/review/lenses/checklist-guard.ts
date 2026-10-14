import type { AgentLearning, AiReviewPayload } from "./schema.js"

export type ToolFailureChecklistResult = {
  readonly ok: boolean
  readonly reason?: string
}

/**
 * Validates the tool-failure checklist rule from the contract:
 * When the run's numbers carry nonzero toolFailures, the agentLearnings lens MUST either:
 * (a) include a learning that cites the per-tool failure counts from the run's numbers, or
 * (b) contain a "Nothing to change for the agent" entry whose detail explicitly states
 *     why no tool-failure learning was warranted.
 *
 * A review with toolFailures > 0 and no such agent learning is incomplete.
 */
export const validateToolFailureChecklist = (
  payload: AiReviewPayload,
  toolFailures: number,
): ToolFailureChecklistResult => {
  if (toolFailures === 0) {
    return { ok: true }
  }

  const agentLearningsLens = payload.lenses.find((lens) => lens.lens === "agentLearnings")
  if (!agentLearningsLens) {
    return {
      ok: false,
      reason: `toolFailures=${toolFailures} but agentLearnings lens is missing`,
    }
  }

  const learnings = agentLearningsLens.learnings
  if (learnings.length === 0) {
    return {
      ok: false,
      reason: `toolFailures=${toolFailures} but agentLearnings has no tool-failure learning`,
    }
  }

  // Check if any learning addresses tool failures
  for (const learning of learnings) {
    if (isToolFailureLearning(learning, toolFailures)) {
      return { ok: true }
    }
  }

  return {
    ok: false,
    reason: `toolFailures=${toolFailures} but agentLearnings has no tool-failure learning`,
  }
}

/**
 * Checks if a learning addresses tool failures by either:
 * 1. Citing per-tool counts from run numbers (mentions tool names with numbers)
 * 2. Being a "Nothing to change for the agent" entry with explicit tool-failure reason
 */
const isToolFailureLearning = (learning: AgentLearning, _toolFailures: number): boolean => {
  const title = learning.title.toLowerCase()
  const detail = learning.detail.toLowerCase()
  const combined = `${title} ${detail}`

  // Check for "Nothing to change for the agent" with tool-failure reason
  if (title.startsWith("nothing to change for the agent")) {
    // Must explicitly mention tool failures or the tool failure count
    const toolFailureKeywords = [
      "tool failure",
      "toolfailures",
      "tool failures",
      "transient",
      "network error",
      "no process change",
    ]
    return toolFailureKeywords.some((keyword) => detail.includes(keyword))
  }

  // Check for learning that cites per-tool counts
  // Look for patterns like "bash=3", "edit=1", "bash 3 times", "3 bash failures", etc.
  const perToolCountPatterns = [
    /\b\w+\s*=\s*\d+/, // tool=count pattern
    /\b\d+\s+\w+\s+failures?/, // "3 bash failures"
    /\b\w+\s+\d+\s+times?/, // "bash 3 times"
    /per.tool.count/i, // "per-tool count"
    /run.numbers/i, // "run numbers"
  ]

  return perToolCountPatterns.some((pattern) => pattern.test(combined))
}
