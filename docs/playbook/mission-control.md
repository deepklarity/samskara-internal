# Mission control: the shared picture of one initiative

One rule for anything long-running, on the page and in chat: the moment
a long run or a subagent starts, say what is running, the clock time it
should finish, and what happens after — and say it again if the estimate
changes. The owner should never have to ask how long something will
take; if they do, the estimate was missing or buried.

## Why it exists

The owner is thinking about ten things at once; an agent session starts
remembering nothing. Mission control is the one page that holds the
shared picture of one initiative so either can arrive cold, read for
three minutes, and act. Every sentence earns its place by serving the
reader who just arrived, not the writer.

## How it talks and looks

The page template (the `mission-control.html` the scaffold run left in
`writeup/agent-readiness/`, rendered from its board) carries the CSS and
structure; reuse it. What the words on it must do:

- **A one-line verdict at the top** that says the situation, including
  the bad part. A reader who stops there has the truth.
- **Every claim carries its own evidence** — the number, the file path,
  the command, the count. A claim without its evidence is an opinion.
- **Worst first**, and **it reads without its author** — no sentence
  needs a person in chat to explain what it meant.
- **A stat appears once**, and each grade is a sentence with its own
  evidence, never a bare word.
- **Status pills carry the word**, never color alone.
- **Heavy secondary material folds** behind a closed toggle whose
  summary line keeps the one-sentence outcome visible.

Voice rules are `tone_and_taste.md` in this folder — plain sentences,
bold as the focus map, no epigrams. That file wins on wording.

## What goes on the page

Four screens, in reading order, one table shape throughout. Each answer
lives in one place — a fact stated twice will eventually drift.

- **Where are we?** A verdict line, then one table: area, one status
  word, one evidence sentence. A grade is a row, never a paragraph.
- **What needs the owner?** A numbered table, highest priority first:
  priority, the decision, what settles it; detail behind the row's
  button; decided rows fold away. This section is either unmissable or
  it says "nothing right now"; nothing else on the page may block on a
  human. A person is asked for two things only: a judgment that is
  theirs to make, and
  permission before real money or an undoable action — anything an
  agent can do or check itself, it does. A change to code, tests or
  config inside a workspace repo is never a decision or a task: it is a
  suggestion (kind `suggestion`), what and where, no patch.
- **The work.** One table for tasks and bugs alike, kind label per row:
  priority, kind, what, closed-when, status. Open rows by priority then
  dependency order, so the first row is what happens next; closed rows
  fold away with proof behind the detail button. Rows with no shared
  dependency run at the same time; rows that touch the same file run in
  sequence. There is no separate next-steps list, roadmap or bug table:
  a bug a task closes lives in that task's detail, and a bug row exists
  only when nothing else covers it.
- **Noticed inside the code.** A plain list, not a table: one sentence
  per suggestion, its file in small mono, no patch. Folded behind a
  summary line naming the count in words; acted-on ones fold under a
  second line.
- **Instruments and references.** One short table of links: the run
  report, the guide, the strategy doc, the registry, the audit pages,
  the log. Live numbers live in the instruments, not here.

**One board, five kinds.** `board.csv` holds tasks, bugs, decisions,
suggestions and learnings, one row shape (`id, kind, title, status,
priority, depends_on, closes_when, notes`), one status set: open,
blocked, done, fixed, worked around, decided, for suggestions noted,
taken, dropped, and for learnings open, folded, dropped. `render_board.py`
writes "What needs the owner", "The work" and "Noticed inside the
code" from the board and puts every task, bug and decision's notes in
a `<dialog>` behind a detail button, so a table cell never holds a
story. Priority (P0, P1, P2) orders task, bug and decision tables;
suggestions and learnings carry none and render as a plain list. What a
learning row is and how to write one is covered in `initiate-scaffold.md`,
hard rule 6.

**Real estate.** `visual_clarity.md` in this folder is the general
rule; here it means a screen shows tables and status words, everything
longer than a sentence behind a click or a fold. "Where are we", "What
needs the owner" and "The work" fit in about two screens; when they do
not, cut rows or move them to the log.

Settled decisions are decision rows with status decided, and they also
live in RESUME.md for agents, who are the ones tempted to re-open them.

## What stays off the page

- **History** lives in `log.md` next to the page: append-only, one
  entry per session, same voice, order set once in `RESUME.md`. It
  exists so a session can audit how things got here; the owner is not
  expected to read it, and no current fact may live only there.
- **Design and reference** live in their canonical doc for the
  workspace; the page links to them, never carries a second copy.
- **Live data** (counts, durations, per-test results) belongs to the
  instrument; the page links to it and never mirrors its numbers,
  because mirrored numbers are stale numbers.

## Mechanics

- The initiative folder is `writeup/<initiative>/`: `board.csv`,
  `mission-control.html`, `log.md`, `RESUME.md`. The page renders from
  the board for people; RESUME is the machine-facing entry point. A
  session reads the board and RESUME, re-renders the page, and does not
  read it; where RESUME and the board disagree, the board wins and
  RESUME gets fixed.
- Day to day, open the file locally — every edit shows on refresh. A
  published artifact is a snapshot for sharing; republish at
  milestones, always to the same URL.
- `board.csv` is the one place task, bug and decision state is
  written; `render_board.py` generates the owner and work sections from
  it, never hand-edited. Update the board and re-render in the same
  turn as the change.
- The working sections should read in about three minutes; past that,
  cut or move.

## Rules learned the hard way

Keep this list growing.

1. **When a milestone lands, sweep every place that states state in one
   pass** — verdict, grades, waiting-on-owner, next steps, bugs — or the
   page ends up saying, simultaneously, that something passed, was
   blocked, and was still to be written.
2. **Never refer to anything by number or position** ("checkpoint 3");
   it breaks silently when the list reorders. Requirements live inside
   the item they apply to; references use names.
3. **One claim per checkbox.** A box holding two milestones can never
   be checked honestly.
4. **A phase is done when its checks pass, everything they found is
   fixed or has a written decision, and the suite itself has been
   reviewed.** First green is one third of done.
5. **Freshness is part of the contract.** A session that changed
   reality and did not update the page did not finish.
6. **One initiative, one page.** A second roadmap gets its own folder;
   the parent keeps one paragraph and a link.
7. **No dates on notes.** A checked box carries proof, not a date — the
   log and git carry time.
8. **Blockers in flight are stated where the reader will look next**,
   and deleted the moment they clear.
9. **Voice drifts by imitation, so sweep it like state.** Reread
   `tone_and_taste.md` before editing; when it gains a rule, sweep this
   page against it in the same pass.
10. **A number lives in one place, and a grade is a sentence.** "Area —
    word" headings are banned — they train later sessions to write
    fragments.
11. **A session that delegates to subagents watches them** — silence is
    not progress. Compare working repos every minute; a quiet minute is
    a glance at processes, three is a log-freshness check (a diff
    watcher misses running suites and gitignored edits), ten is a real
    investigation. Delegated agents wait in their own foreground; if
    one parks on a background process anyway, arm a notifier on it
    ending.
12. **Parallelize delegated tasks by file overlap, not by board order.**
    Tasks with disjoint file sets run together regardless of board
    order; tasks that share a file run in sequence.
13. **The verdict and grades name things by what they do, not by their
    identifiers.** A grade built from tool flags, service names and
    commit hashes reads as jargon to the owner; those belong in the log
    or the linked page, not the grade, unless the reader must type one.
14. **One status vocabulary for the whole page.** Checkboxes, pills and
    grades all speak the same small set (done, open, blocked, fixed,
    worked around); a new word joins only when no existing one is
    honest, and then everywhere.
15. **Finished work never sits under a next-actions heading, even
    relabeled** — a heading's meaning is what belongs under it, not the
    words inside each item.

## Starting a new initiative

1. Make `writeup/<initiative>/` with the four files: `board.csv`,
   `mission-control.html`, `log.md`, `RESUME.md`.
2. Reuse the page template's CSS — tokens, checklist, table and details
   styles, light only, no build step.
3. First log entry: what was agreed, confidence, known risks.
