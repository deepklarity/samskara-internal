import type { BreadcrumbLearning } from "./schema.js"

export type BreadcrumbValidationResult = {
  readonly ok: boolean
  readonly flaggedReasons: ReadonlyArray<string>
}

/**
 * Validates a breadcrumb against session-specific pointer rules.
 * A breadcrumb must survive the "strip every session-specific name" test.
 * Returns flagged reasons if the breadcrumb contains session-specific references
 * that would not survive the strip test.
 */
export const validateBreadcrumb = (breadcrumb: BreadcrumbLearning): BreadcrumbValidationResult => {
  const reasons: string[] = []
  const textToCheck = `${breadcrumb.title} ${breadcrumb.detail}`

  // Check for workspace file paths (contains '/' with extension like .md/.ts/.js/.json/.yaml/.yml)
  const workspacePathRegex = /\b(?:writeup|docs|packages)\/[^\s]+\.(?:md|ts|js|json|yaml|yml)\b/g
  const workspacePaths = textToCheck.match(workspacePathRegex)
  if (workspacePaths) {
    for (const path of workspacePaths) {
      reasons.push(`contains workspace file path (${path})`)
    }
  }

  // Check for RESUME references (case-insensitive)
  if (/\bRESUME\b/i.test(textToCheck)) {
    reasons.push("references 'RESUME' file (session-specific pointer)")
  }

  // Check for branch-like tokens (feat/, fix/, chore/, refactor/, test/, docs/, style/, perf/, ci/, build/, revert/)
  const branchPrefixes = [
    "feat/",
    "fix/",
    "chore/",
    "refactor/",
    "test/",
    "docs/",
    "style/",
    "perf/",
    "ci/",
    "build/",
    "revert/",
  ]
  for (const prefix of branchPrefixes) {
    if (textToCheck.includes(prefix)) {
      reasons.push(`contains branch-like token (${prefix})`)
    }
  }

  // Check for PR-like tokens (pr-<digits>)
  const prTokenRegex = /\bpr-\d+\b/gi
  const prTokens = textToCheck.match(prTokenRegex)
  if (prTokens) {
    for (const token of prTokens) {
      reasons.push(`contains PR-like token (${token})`)
    }
  }

  return {
    ok: reasons.length === 0,
    flaggedReasons: reasons,
  }
}
