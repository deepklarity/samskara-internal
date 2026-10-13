/**
 * The lean pointer-prompt for a harness agent reviewing one exported session. The full
 * contract lives in the workspace as `CONTRACT.md` (core's `reviewContractMd`), staged by
 * the pipeline beside `session.json` and the pre-written `review.xml` — so this prompt only
 * names the three files, states the one inviolable deliverable rule, and defers everything
 * else to the file the agent can re-read at any point without spending starting context.
 * Deterministic: the same options always produce the same prompt, byte for byte.
 */
export type ReviewPromptOptions = {
  readonly sessionMeta: {
    readonly sessionId: string
    readonly title: string
    readonly startedAt?: string
    readonly endedAt?: string
    readonly source: string
  }
  /**
   * Absolute workspace dir. The pipeline always passes it; named paths keep the
   * reviewer from hunting (a lost reviewer exits 0 with nothing written — the
   * `deliverableMissing` the server cannot distinguish from a quiet success).
   */
  readonly workspaceDir?: string
  /**
   * How hard to work: review depth, not model size. Standard behaves exactly as
   * the contract describes. Low caps scope for a fast pass; deep expands it.
   */
  readonly effort?: "low" | "standard" | "deep"
}

const sessionSection = (meta: ReviewPromptOptions["sessionMeta"]): string[] => [
  "## Session",
  "",
  `- sessionId: ${meta.sessionId}`,
  `- title: ${meta.title}`,
  `- source: ${meta.source}`,
  ...(meta.startedAt === undefined ? [] : [`- startedAt: ${meta.startedAt}`]),
  ...(meta.endedAt === undefined ? [] : [`- endedAt: ${meta.endedAt}`]),
  "",
]

const workspaceSection = (workspaceDir?: string): string[] => {
  const at = (name: string): string =>
    workspaceDir === undefined ? `\`${name}\`` : `\`${workspaceDir}/${name}\``
  return [
    "## Your working directory",
    "",
    ...(workspaceDir === undefined
      ? []
      : [
          `0. First run \`pwd\` and \`ls ${workspaceDir}\`. The three files below live under ${workspaceDir} — use those absolute paths for every read and write. If they are not there, reply NO_FILES and stop: never review from memory.`,
          "",
        ]),
    `- ${at("CONTRACT.md")} — the review contract: the exact verdict vocabulary, section rules, attribution and grounding rules, and how to assemble the file. Read it first; re-read any rule whenever you need it.`,
    `- ${at("session.json")} — the exported session under review. The only data source: every citable record with seq, id (msg-N), role, tool name, result status, text excerpt, track, ts. Judge this session — not the task of reviewing, and not any session the transcript merely talks about.`,
    `- ${at("review.xml")} — the pre-written skeleton you fill in, in place, section by section.`,
    "",
  ]
}

const effortSection = (effort?: "low" | "standard" | "deep"): string[] => {
  if (effort === undefined || effort === "standard") return []
  if (effort === "low")
    return [
      "## Effort: fast pass",
      "",
      "Work fast: at most 4 timeline entries; write a learning only for high-severity findings; an empty section with a reason beats filler.",
      "",
    ]
  return [
    "## Effort: deep pass",
    "",
    "Be thorough: up to 10 timeline entries; check every failure mode twice, including secondary evidence; chase one level deeper than the contract's minimum.",
    "",
  ]
}

const DELIVERABLE = [
  "## Deliverable",
  "",
  'Fill in `review.xml` following `CONTRACT.md`. The file is the deliverable — never emit the whole review in one message; append one well-formed element at a time. Your final reply is one short line (e.g. "review.xml ready: 7 timeline entries").',
  "",
]

export const buildReviewPrompt = (options: ReviewPromptOptions): string =>
  [
    "You are reviewing a recorded AI coding session.",
    "",
    ...sessionSection(options.sessionMeta),
    ...workspaceSection(options.workspaceDir),
    ...effortSection(options.effort),
    ...DELIVERABLE,
  ]
    .join("\n")
    .trimEnd()
