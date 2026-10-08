/**
 * The reviewer's reference document, staged into the workspace as `CONTRACT.md` beside
 * `session.json` and the pre-written `review.xml`. The prompt deliberately stays lean — it
 * names the three files and points here — so the agent never has to hold the whole spec in
 * its starting context: it can re-read any rule at any point mid-review, and a context
 * refresh costs one file read instead of the whole contract.
 *
 * Deterministic by construction (a static string): the same bytes every run, so tests,
 * prompts and the staged file cannot drift apart. Written in the house voice
 * (docs/playbook/tone_and_taste.md): plain sentences, the words you'd say out loud.
 */
export const reviewContractMd = (): string => `# Review contract

You are reviewing a recorded AI coding session. Your working directory holds everything:

- \`session.json\` — the session under review. Every record carries \`seq\`, \`id\` (\`msg-N\`),
  \`role\`, tool name, result status, a text excerpt, \`track\`, and \`ts\` (epoch ms). It is
  the only data source; there is no other.
- \`review.xml\` — the skeleton you fill in. Its sections are already there (\`summary\`,
  \`timeline\`, \`humanLearnings\`, \`agentLearnings\`, \`breadcrumbs\`, \`counts\`): work inside
  them, and add as many entries as the session earns. Do not invent new top-level sections.
- this file — the rules below.

## The deliverable

The file \`review.xml\` is the deliverable, not your reply. Keep the skeleton's structure
exactly, and append one well-formed element at a time. When you are done, your final reply
is one short line (for example: "review.xml ready: 7 timeline entries").

## The verdict attributes

The root element carries two verdict attributes. They take exact words, and no others —
not "partial", not "complete":

- \`outcome\`: exactly one of
  \`shipped\` (the work landed) |
  \`productive\` (real work happened, nothing landed) |
  \`struggled\` (most of the session was stuck) |
  \`aborted\` (the session ended before the work did)
- \`friction\`: exactly one of \`none\` | \`moderate\` | \`high\`

Judge the session you read in \`session.json\` — not the task of reviewing, and not any
session the transcript merely talks about.

## How to fill it

Work forward, writing as you go: after reading \`session.json\`, write the summary first, then
the timeline, then the learnings and breadcrumbs, then counts. Do not compose the whole
review in your head before the first write — drafting before writing is the largest cost of
the run, and the run has a hard time limit.

1. Append each element with a small node script, written as a heredoc (\`node <<'JS'\`) —
   never \`node -e "..."\`, where double quotes break. This workspace has \`node\` and nothing
   else: no python, no xmllint. Use node for every edit, count, and check; do not probe for
   other tools.
2. Each section of the skeleton holds a worked example inside an XML comment. Repeat that
   block once per real entry, then delete the example.
3. Fill \`<counts>\` in the same script that writes the last section — programmatically, never
   by hand.
4. Check well-formedness in that script too. Do not re-read \`review.xml\` with the Read tool
   afterwards; verify by script only. If you are short on time, a complete \`review.xml\`
   without a final chat line still counts — the file is the deliverable.

## What goes in each section

- \`summary\`: one honest paragraph, at most 600 characters.
- \`timeline\`: the phases and turning points only — about 5 to 8 entries, in ascending
  \`from-seq\` order.
- Every learning carries \`audience\` (matching its section), \`severity\`
  (\`low|medium|high\`), one imperative \`nextTime\` sentence, and \`cost\` when you can
  measure it (for example \`cost="95s of 278s"\`).

## The two audiences, and the breadcrumbs

- \`humanLearnings\` — what the person could do differently: prompt wording, missing
  context, task shape, a course correction that arrived late.
- \`agentLearnings\` — what the agent could do better: wasted effort, a wrong approach, tool
  misuse, process mistakes.
- \`breadcrumbs\` — the reusable things this run discovered: a query, command, file path, or
  procedure that the next agent can use instead of working it out again. A breadcrumb is
  not a correction; it is a map marker. Only record it when it is standard enough to be
  worth keeping, and cite where in the transcript it was worked out.

A learning must name a change, not a compliment. "Keep doing what you did" is not a
learning — if a behavior was right, say so in the summary and write the "Nothing to
change" entry for that audience. Write a learning only when something observable would
improve next time.

If an audience has nothing to change, still write one entry titled "Nothing to change for
the human" (or "for the agent"); its nextTime may stay empty.

## Grounding — the server checks every reference

- Cite only seqs and \`msg-N\` ids that appear in \`session.json\`. Never invent ids, seqs or
  tracks.
- Every real learning needs at least one \`<ref>\`; a claim with no citation is dropped, and
  self-certification is forbidden.
- If the evidence is thin, say less.

## Failure modes — check every one, each pass

Run through this list before you write the learnings. Each mode says where it shows up in
\`session.json\` and which section it feeds. When a mode fits, write the learning; when none
fit, say so in the summary instead of stretching one.

- Trusted a stale note — the agent copied claims from a guide or an old message without
  checking the code as it stands. Look for excerpts that quote a doc followed by an edit
  that the code contradicts. Feeds agentLearnings.
- Missed what already exists — the agent wrote its own scripts or queries instead of using
  the team's tools. Look for new throwaway scripts where the transcript never mentions the
  existing tool or command. Feeds agentLearnings, and breadcrumbs when you name the tool.
- Took the long way — the agent ran repeated searches or raw queries that one tool call
  could have done. Look for the same search or query shape three or more times in a row.
  Feeds agentLearnings.
- Hit tool failures — the agent retried a failing command instead of stopping to read the
  error. Look for error results on the same tool and count them per tool in the learning. The
  run's numbers carry the same per-tool counts — cite them instead of recounting.
  Feeds agentLearnings.
- Started from an unclear task — the request had two meanings and the agent picked one
  without asking. Look for the first message carrying two possible readings and no
  clarifying question after it. Feeds humanLearnings.
- Re-read what was already read — the agent opened the same files again instead of using
  what it had. Look for repeat reads of the same path with nothing changed between them.
  Feeds agentLearnings.
- Waited on permission that never came — the session stalled on an approval or a blocked
  prompt. Look for long gaps in \`ts\` after a permission-denied or approval result.
  Feeds humanLearnings.
- Declared done without running anything — the agent said the work was finished with no
  test, check, or run in the transcript to back it. Look for a done claim with no passing
  result near it. Feeds agentLearnings.
- Ignored the docs and skills that were there — the transcript never opened the guide or
  skill the task needed. Look for a wrong turn the open guide would have prevented.
  Feeds agentLearnings.
- Worked in a line that could have run side by side — independent calls went one at a
  time. Look for sequential \`ts\` on calls with no data between them. Feeds agentLearnings.
- Pushed on through a broken setup — the environment was failing and the agent kept
  working instead of flagging it. Look for setup or install errors early with normal work
  continuing after them. Feeds humanLearnings.
`
