import { describe, expect, test } from "vitest"
import {
  aiReviewPayloadV2Schema,
  buildReviewPromptV2,
  parseReviewXmlV2,
  reviewContractMdV2,
  reviewXmlTemplateV2,
  validateGroundingV2,
} from "./index.js"

const improvement = {
  title: "Make the existing helper discoverable",
  detail: "The agent rebuilt a helper that was already present.",
  sessionTrigger: "The agent rebuilt the helper during the session.",
  systemGap: "The helper was hard to discover.",
  codeProof: "The start tree contains the helper, which the transcript alone cannot prove.",
  futureReuse: "Future tasks needing the helper can reuse it.",
  proposedChange: "Link the helper from the relevant skill.",
  counterfactual: "The agent would likely have skipped rebuilding the helper.",
  validationIdea: "Run a similar session and check whether the agent finds it.",
  status: "already-present" as const,
  evidenceBasis: "code-backed" as const,
  sessionEvidence: [{ seq: 1, messageId: "msg-1", what: "The agent rebuilt the helper." }],
  codeEvidence: [
    { repo: "org/repo", path: "src/helper.ts", revision: "abc123", fromLine: 2, toLine: 8 },
  ],
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<review outcome="shipped" friction="none" model="?" harness="?">
  <summary>The agent rebuilt an existing helper.</summary>
  <timeline><entry id="work" kind="phase" from-seq="1" to-seq="1" tracks="main"><title>Work</title><summary>Rebuilt a helper.</summary><message-ids><id>msg-1</id></message-ids></entry></timeline>
  <humanLearnings></humanLearnings><agentLearnings></agentLearnings><breadcrumbs></breadcrumbs>
  <improvements><improvement status="already-present" evidence-basis="code-backed">
    <title>Make the existing helper discoverable</title>
    <detail>The agent rebuilt a helper that was already present.</detail>
    <sessionTrigger>The agent rebuilt the helper during the session.</sessionTrigger>
    <systemGap>The helper was hard to discover.</systemGap>
    <codeProof>The start tree contains the helper, which the transcript alone cannot prove.</codeProof>
    <futureReuse>Future tasks needing the helper can reuse it.</futureReuse>
    <proposedChange>Link the helper from the relevant skill.</proposedChange>
    <counterfactual>The agent would likely have skipped rebuilding the helper.</counterfactual>
    <validationIdea>Run a similar session and check whether the agent finds it.</validationIdea>
    <sessionEvidence><ref seq="1" message-id="msg-1"><what>The agent rebuilt the helper.</what></ref></sessionEvidence>
    <codeEvidence><citation repo="org/repo" path="src/helper.ts" revision="abc123" from-line="2" to-line="8"/></codeEvidence>
  </improvement></improvements>
  <counts timeline="1" human="0" agent="0" breadcrumbs="0" improvements="1"/>
</review>`

describe("ai-v2 review contract", () => {
  test("exposes a separate code-aware prompt and template", () => {
    expect(
      buildReviewPromptV2({ sessionMeta: { sessionId: "s", title: "t", source: "claude" } }),
    ).toContain("CONTRACT.md")
    expect(reviewContractMdV2()).toContain("session.json")
    expect(reviewContractMdV2()).toContain("session-grounded")
    expect(reviewContractMdV2()).toContain("read-only")
    expect(reviewXmlTemplateV2()).toContain("<improvements>")
  })

  test("tells the reviewer to keep improvement fields within the XML limits", () => {
    const contract = reviewContractMdV2()
    expect(contract).toContain("<sessionTrigger>")
    expect(contract).toContain("400 characters")
    expect(contract).toContain("<detail>")
    expect(contract).toContain("600 characters")
    expect(contract).toContain("summarize")
  })

  test("parses a code-backed improvement separately from v1 lenses", () => {
    const parsed = parseReviewXmlV2(xml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.analyzer).toBe("ai-v2")
    expect(parsed.value.improvements.entries).toEqual([improvement])
    expect(parsed.selfCounts?.improvements).toBe(1)
  })

  test("reports a mismatched improvement count", () => {
    const parsed = parseReviewXmlV2(xml.replace('improvements="1"', 'improvements="2"'))
    expect(parsed.ok).toBe(true)
    expect(parsed.recovered).toContain("counts mismatch: improvements claimed 2, parsed 1")
  })

  test("decodes entities in improvement text", () => {
    const parsed = parseReviewXmlV2(
      xml.replace("Link the helper from the relevant skill.", "Link the helper &amp; skill."),
    )
    expect(parsed.ok).toBe(true)
    if (parsed.ok)
      expect(parsed.value.improvements.entries[0]?.proposedChange).toBe("Link the helper & skill.")
  })

  test("allows session-only proposals only with unverified status", () => {
    const result = parseReviewXmlV2(
      xml
        .replace(
          'status="already-present" evidence-basis="code-backed"',
          'status="unverified" evidence-basis="session-only"',
        )
        .replace(/<codeProof>[\s\S]*?<\/codeProof>/, "")
        .replace(/<codeEvidence>[\s\S]*?<\/codeEvidence>/, "<codeEvidence/>"),
    )
    expect(result.ok).toBe(true)
    const invalid = aiReviewPayloadV2Schema.safeParse({
      ...(result.ok ? result.value : {}),
      improvements: {
        lens: "improvements",
        entries: [{ ...improvement, sessionEvidence: [], codeEvidence: [] }],
      },
    })
    expect(invalid.success).toBe(false)
  })

  test("grounds every improvement in the session export", () => {
    const parsed = parseReviewXmlV2(xml)
    if (!parsed.ok) throw new Error(parsed.error)
    const result = validateGroundingV2(parsed.value, {
      seqs: new Set([1]),
      messageIds: new Set(["msg-1"]),
      tracks: new Set(["main"]),
    })
    expect(result.ok).toBe(true)
    const ungrounded = validateGroundingV2(
      {
        ...parsed.value,
        improvements: {
          lens: "improvements",
          entries: [
            { ...improvement, sessionEvidence: [{ seq: 2, messageId: "msg-2", what: "Invented" }] },
          ],
        },
      },
      { seqs: new Set([1]), messageIds: new Set(["msg-1"]), tracks: new Set(["main"]) },
    )
    expect(ungrounded.ok).toBe(false)
  })
})
