import type { AiReviewPayloadV2, GroundingProblem, GroundingResult } from "@samskara/core"
import type { ReviewEvidenceManifest } from "./evidence.js"

const repoThing = "(?:doc(?:umentation)?|skill|helper|tool|test|config|file|prompt|breadcrumb)s?"
const presenceClaim = new RegExp(
  `\\b(?:already\\s+(?:exists?|existed|present|available)|does\\s+not\\s+exist|do\\s+not\\s+exist|is\\s+missing|are\\s+missing|not\\s+present|no\\s+(?:existing\\s+)?${repoThing}\\s+exists?|(?:existing|missing)\\s+${repoThing})\\b`,
  "i",
)

/**
 * The XML schema checks citation shape. This gate resolves each citation against immutable
 * bytes recorded in the evidence manifest before a review can be saved.
 */
export const validateCodeGroundingV2 = (
  payload: AiReviewPayloadV2,
  manifest: ReviewEvidenceManifest,
): GroundingResult => {
  const problems: GroundingProblem[] = []

  for (const [entryIndex, entry] of payload.improvements.entries.entries()) {
    const entryPath = `improvements.entries[${entryIndex}]`
    if (entry.evidenceBasis === "session-only") {
      if (entry.status !== "unverified") {
        problems.push({
          path: `${entryPath}.status`,
          problem: "session-only evidence requires unverified status",
        })
      }
      if (entry.codeEvidence.length > 0) {
        problems.push({
          path: `${entryPath}.codeEvidence`,
          problem: "session-only evidence cannot cite code",
        })
      }
      // A transcript can motivate a durable proposal, but cannot establish repo presence.
      for (const field of [
        "title",
        "detail",
        "sessionTrigger",
        "systemGap",
        "codeProof",
        "futureReuse",
        "proposedChange",
        "counterfactual",
        "validationIdea",
      ] as const) {
        if (presenceClaim.test(entry[field] ?? "")) {
          problems.push({
            path: `${entryPath}.${field}`,
            problem: "repository presence claim requires code or artifact evidence",
          })
        }
      }
    } else if (entry.codeEvidence.length === 0) {
      problems.push({
        path: `${entryPath}.codeEvidence`,
        problem: "code-backed improvement requires a staged code citation",
      })
    }
    if (entry.status !== "unverified" && entry.evidenceBasis !== "code-backed") {
      problems.push({
        path: `${entryPath}.evidenceBasis`,
        problem: "verified status requires code-backed evidence",
      })
    }

    for (const [citationIndex, citation] of entry.codeEvidence.entries()) {
      const path = `${entryPath}.codeEvidence[${citationIndex}]`
      const staged = manifest.citations.find(
        (candidate) =>
          candidate.repo === citation.repo &&
          candidate.path === citation.path &&
          candidate.revision === citation.revision &&
          (citation.hash === undefined || candidate.sha256 === citation.hash),
      )
      if (!staged) {
        problems.push({
          path,
          problem: "citation does not match staged repo, path, revision, and hash",
        })
        continue
      }
      const from = citation.fromLine
      const to = citation.toLine
      if ((from === undefined) !== (to === undefined)) {
        problems.push({ path, problem: "citation must provide both line bounds" })
      } else if (
        from !== undefined &&
        to !== undefined &&
        (staged.lines === undefined || from < 1 || to < from || to > staged.lines)
      ) {
        problems.push({ path, problem: "line range is outside staged text evidence" })
      }
    }
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}
