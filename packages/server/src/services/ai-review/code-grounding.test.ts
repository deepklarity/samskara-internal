import type { AiReviewPayloadV2, CodeCitationV2, ImprovementV2 } from "@samskara/core"
import { describe, expect, test } from "vitest"
import { validateCodeGroundingV2 } from "./code-grounding.js"
import type { ReviewEvidenceManifest } from "./evidence.js"

const citation: CodeCitationV2 = {
  repo: "acme/example",
  path: "src/helper.ts",
  revision: "a".repeat(40),
  hash: "b".repeat(64),
  fromLine: 1,
  toLine: 3,
}
const improvement = (overrides: Partial<ImprovementV2> = {}): ImprovementV2 => ({
  title: "Surface the existing helper",
  detail: "The session agent recreated a helper that was present at the start.",
  sessionTrigger: "The agent recreated the helper in this session.",
  systemGap: "The existing helper was hard to discover.",
  codeProof: "The start tree proves the helper already existed.",
  futureReuse: "Similar tasks can reuse the helper.",
  proposedChange: "Link the helper from the skill.",
  counterfactual: "The agent would likely have avoided recreating the helper.",
  validationIdea: "Check whether the agent finds it in a similar session.",
  status: "already-present",
  evidenceBasis: "code-backed",
  sessionEvidence: [{ seq: 1, messageId: "msg-1", what: "The agent recreated the helper." }],
  codeEvidence: [citation],
  ...overrides,
})
const payload = (...entries: ImprovementV2[]): AiReviewPayloadV2 =>
  ({ analyzer: "ai-v2", improvements: { lens: "improvements", entries } }) as AiReviewPayloadV2
const manifest = (citations: ReviewEvidenceManifest["citations"]): ReviewEvidenceManifest =>
  ({ citations }) as ReviewEvidenceManifest
const available = {
  repo: citation.repo,
  path: citation.path,
  revision: citation.revision,
  sha256: citation.hash ?? "",
  kind: "start-tree" as const,
  lines: 3,
  stagedPath: "tree/src/helper.ts",
}

describe("validateCodeGroundingV2", () => {
  test("accepts an exact staged citation and a concrete session-only proposal", () => {
    const transcriptOnly = improvement({
      title: "Clarify skill invocation",
      detail: "The agent asked for a command it could have found through a skill.",
      proposedChange: "Document when to invoke the skill.",
      status: "unverified",
      evidenceBasis: "session-only",
      codeEvidence: [],
    })
    expect(
      validateCodeGroundingV2(payload(improvement(), transcriptOnly), manifest([available])),
    ).toEqual({ ok: true })
  })

  test.each([
    ["repository", { repo: "other/example" }],
    ["path", { path: "src/other.ts" }],
    ["revision", { revision: "c".repeat(40) }],
    ["hash", { hash: "d".repeat(64) }],
  ])("rejects a citation with the wrong %s", (_name, mismatch) => {
    const result = validateCodeGroundingV2(
      payload(improvement({ codeEvidence: [{ ...citation, ...mismatch }] })),
      manifest([available]),
    )
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.problems).toContainEqual(
        expect.objectContaining({ path: "improvements.entries[0].codeEvidence[0]" }),
      )
  })

  test("rejects invented line ranges and ranges for evidence without text lines", () => {
    const pastEnd = validateCodeGroundingV2(
      payload(improvement({ codeEvidence: [{ ...citation, toLine: 4 }] })),
      manifest([available]),
    )
    expect(pastEnd.ok).toBe(false)
    const noLines = validateCodeGroundingV2(
      payload(improvement()),
      manifest([{ ...available, lines: undefined }]),
    )
    expect(noLines.ok).toBe(false)
  })

  test("rejects missing code citations for code-backed and verified statuses", () => {
    const result = validateCodeGroundingV2(
      payload(improvement({ codeEvidence: [] })),
      manifest([available]),
    )
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.problems).toContainEqual(
        expect.objectContaining({ path: "improvements.entries[0].codeEvidence" }),
      )
  })

  test("rejects session-only claims that a repository helper already exists", () => {
    const entry = improvement({
      title: "Surface the existing helper",
      detail: "The helper already exists in src/helper.ts, but the session agent missed it.",
      status: "unverified",
      evidenceBasis: "session-only",
      codeEvidence: [],
    })
    const result = validateCodeGroundingV2(payload(entry), manifest([]))
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.problems).toContainEqual(
        expect.objectContaining({ path: "improvements.entries[0].detail" }),
      )
  })

  test("rejects session-only missing-file claims without rejecting a proposal to document behavior", () => {
    const missing = improvement({
      title: "Add the missing skill",
      detail: "The session agent did not find guidance for the command.",
      proposedChange: "Document when to invoke the skill.",
      status: "unverified",
      evidenceBasis: "session-only",
      codeEvidence: [],
    })
    const result = validateCodeGroundingV2(payload(missing), manifest([]))
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.problems).toContainEqual(
        expect.objectContaining({ path: "improvements.entries[0].title" }),
      )
  })
})
