import { describe, expect, test } from "vitest"
import { type BreadcrumbValidationResult, validateBreadcrumb } from "./breadcrumb-guard.js"

describe("validateBreadcrumb", () => {
  test("passes a breadcrumb that survives the strip test (no session-specific names)", () => {
    const result = validateBreadcrumb({
      title: "The psql query that lists failed jobs",
      detail: "SELECT * FROM jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 20",
      category: "query",
      audience: "agent",
      severity: "low",
      nextTime: "Reach for this before writing a new query against the jobs table.",
      evidence: [{ seq: 14, messageId: "msg-14", what: "the query was worked out here" }],
    })
    expect(result.ok).toBe(true)
    expect(result.flaggedReasons).toHaveLength(0)
  })

  test("flags a breadcrumb containing a workspace file path with extension", () => {
    const result = validateBreadcrumb({
      title: "Next-task lookup in the refactor RESUME file",
      detail: "Check writeup/self-learning/RESUME.md for the next task after the refactor.",
      category: "path",
      audience: "agent",
      severity: "low",
      nextTime: "Read the RESUME file to find the next task.",
      evidence: [{ seq: 5, messageId: "msg-5", what: "agent looked at RESUME" }],
    })
    expect(result.ok).toBe(false)
    expect(result.flaggedReasons).toContain(
      "contains workspace file path (writeup/self-learning/RESUME.md)",
    )
  })

  test("flags a breadcrumb containing 'RESUME' reference", () => {
    const result = validateBreadcrumb({
      title: "Sim-mode AFM verification loop",
      detail: "The RESUME file documents the AFM verification steps for sim-mode.",
      category: "procedure",
      audience: "agent",
      severity: "low",
      nextTime: "Follow the RESUME file steps for AFM verification.",
      evidence: [{ seq: 10, messageId: "msg-10", what: "AFM verification documented" }],
    })
    expect(result.ok).toBe(false)
    expect(result.flaggedReasons).toContain("references 'RESUME' file (session-specific pointer)")
  })

  test("flags a breadcrumb containing a branch-like token (feat/)", () => {
    const result = validateBreadcrumb({
      title: "Feature branch setup notes",
      detail: "Work on feat/user-authentication branch for the auth refactor.",
      category: "path",
      audience: "agent",
      severity: "low",
      nextTime: "Check feat/user-authentication for the latest changes.",
      evidence: [{ seq: 3, messageId: "msg-3", what: "branch mentioned" }],
    })
    expect(result.ok).toBe(false)
    expect(result.flaggedReasons).toContain("contains branch-like token (feat/)")
  })

  test("flags a breadcrumb containing a PR-like token (pr-<digits>)", () => {
    const result = validateBreadcrumb({
      title: "PR review checklist",
      detail: "Follow the pr-29 checklist for the review process.",
      category: "procedure",
      audience: "agent",
      severity: "low",
      nextTime: "Use pr-29 checklist for future reviews.",
      evidence: [{ seq: 7, messageId: "msg-7", what: "PR checklist mentioned" }],
    })
    expect(result.ok).toBe(false)
    expect(result.flaggedReasons).toContain("contains PR-like token (pr-29)")
  })

  test("flags a breadcrumb containing a docs/ workspace path", () => {
    const result = validateBreadcrumb({
      title: "Documentation update procedure",
      detail: "Update docs/architecture/decisions.md when making changes.",
      category: "path",
      audience: "agent",
      severity: "low",
      nextTime: "Edit docs/architecture/decisions.md for architecture decisions.",
      evidence: [{ seq: 2, messageId: "msg-2", what: "docs path mentioned" }],
    })
    expect(result.ok).toBe(false)
    expect(result.flaggedReasons).toContain(
      "contains workspace file path (docs/architecture/decisions.md)",
    )
  })

  test("flags a breadcrumb containing a writeup/ workspace path", () => {
    const result = validateBreadcrumb({
      title: "Writeup reference",
      detail: "See writeup/project/overview.md for the project overview.",
      category: "path",
      audience: "agent",
      severity: "low",
      nextTime: "Read writeup/project/overview.md for context.",
      evidence: [{ seq: 1, messageId: "msg-1", what: "writeup mentioned" }],
    })
    expect(result.ok).toBe(false)
    expect(result.flaggedReasons).toContain(
      "contains workspace file path (writeup/project/overview.md)",
    )
  })

  test("flags a breadcrumb containing a .ts file path in workspace", () => {
    const result = validateBreadcrumb({
      title: "TypeScript helper location",
      detail: "The helper lives at packages/core/src/utils/helpers.ts",
      category: "path",
      audience: "agent",
      severity: "low",
      nextTime: "Import from packages/core/src/utils/helpers.ts",
      evidence: [{ seq: 4, messageId: "msg-4", what: "helper path mentioned" }],
    })
    expect(result.ok).toBe(false)
    expect(result.flaggedReasons).toContain(
      "contains workspace file path (packages/core/src/utils/helpers.ts)",
    )
  })

  test("passes a breadcrumb with a generic command (no session specifics)", () => {
    const result = validateBreadcrumb({
      title: "Failed jobs lookup command",
      detail: "psql -c \"SELECT * FROM jobs WHERE status = 'failed'\"",
      category: "command",
      audience: "agent",
      severity: "low",
      nextTime: "Run this command to list failed jobs.",
      evidence: [{ seq: 8, messageId: "msg-8", what: "command worked out" }],
    })
    expect(result.ok).toBe(true)
    expect(result.flaggedReasons).toHaveLength(0)
  })

  test("passes a breadcrumb with a generic procedure (no session specifics)", () => {
    const result = validateBreadcrumb({
      title: "Database migration rollback procedure",
      detail: "Run the down migration script, then verify schema version.",
      category: "procedure",
      audience: "agent",
      severity: "medium",
      nextTime: "Follow these steps to rollback a failed migration.",
      evidence: [{ seq: 12, messageId: "msg-12", what: "rollback procedure worked out" }],
    })
    expect(result.ok).toBe(true)
    expect(result.flaggedReasons).toHaveLength(0)
  })

  test("flags multiple reasons when breadcrumb has multiple session-specific elements", () => {
    const result = validateBreadcrumb({
      title: "PR 29 on feat/auth branch RESUME notes",
      detail:
        "Check writeup/self-learning/RESUME.md for pr-29 details on feat/authentication branch.",
      category: "path",
      audience: "agent",
      severity: "low",
      nextTime: "Review the RESUME file.",
      evidence: [{ seq: 1, messageId: "msg-1", what: "multiple refs" }],
    })
    expect(result.ok).toBe(false)
    expect(result.flaggedReasons.length).toBeGreaterThanOrEqual(3)
  })

  test("flags breadcrumb with branch name containing pr- prefix", () => {
    const result = validateBreadcrumb({
      title: "Branch naming convention",
      detail: "Use pr-123-feature-name for feature branches.",
      category: "procedure",
      audience: "agent",
      severity: "low",
      nextTime: "Follow the pr-XXX naming pattern.",
      evidence: [{ seq: 1, messageId: "msg-1", what: "branch naming mentioned" }],
    })
    expect(result.ok).toBe(false)
    expect(result.flaggedReasons).toContain("contains PR-like token (pr-123)")
  })

  test("flags breadcrumb with fix/ branch prefix", () => {
    const result = validateBreadcrumb({
      title: "Hotfix branch notes",
      detail: "Work done on fix/critical-bug branch.",
      category: "path",
      audience: "agent",
      severity: "low",
      nextTime: "Check fix/critical-bug for the hotfix.",
      evidence: [{ seq: 1, messageId: "msg-1", what: "fix branch mentioned" }],
    })
    expect(result.ok).toBe(false)
    expect(result.flaggedReasons).toContain("contains branch-like token (fix/)")
  })

  test("flags breadcrumb with chore/ branch prefix", () => {
    const result = validateBreadcrumb({
      title: "Chore branch reference",
      detail: "Updates on chore/dependency-updates branch.",
      category: "path",
      audience: "agent",
      severity: "low",
      nextTime: "Review chore/dependency-updates.",
      evidence: [{ seq: 1, messageId: "msg-1", what: "chore branch mentioned" }],
    })
    expect(result.ok).toBe(false)
    expect(result.flaggedReasons).toContain("contains branch-like token (chore/)")
  })
})
