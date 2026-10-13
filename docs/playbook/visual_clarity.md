# Visual clarity: what a screen shows, and what waits behind a click

This applies to every page a person reads: mission control, the test
report, a system guide, an audit write-up. `tone_and_taste.md` says how a
sentence sounds; this says what a screen holds. When they meet, the tone
doc wins on wording and this doc wins on layout.

## The rule

A screen is a fixed amount of attention. Everything on it competes for
the same eyes, so each thing shown must earn its place against the
things it pushes down. The test: cover the page with your hand and reveal
one screen at a time. If the reader cannot act on what a screen shows
without scrolling for the rest, the screen is holding the wrong things.

## What a screen holds

- **The answer, then its evidence.** The first screen carries the
  verdict sentence and one table of status words with a sentence each.
  A reader who stops there has the truth.
- **Tables, not paragraphs, for anything that repeats.** Three things of
  the same shape are a table with short cells. A paragraph per item was
  how mission control's grades became eight blocks nobody compared.
- **One row per thing, one status word per row.** A row holds what it
  is, one status word, and one sentence that says when it is closed.
  Nothing else. The story behind a row is one click away.
- **A short cell.** A cell holds a name, a number, a status word or one
  sentence. A cell that wraps to three lines is a paragraph hiding in a
  table; move it behind the row's detail.
- **Numbers live once, in the instrument that measured them.** A page
  that tracks work links to the report; it does not copy the report's
  counts, because copied numbers are stale numbers.
- **One status vocabulary per page**, and the word is always present.
  Colour marks the word; it never replaces it.
- **Priority orders every table.** P0 rows first. A reader who reads
  only the first row still read the right one.

## What waits behind a click

- **Detail opens in a modal.** Notes, options, evidence, the commit that
  changed a contract: a detail button on the row opens a `<dialog>`.
  The table stays narrow and the detail stays whole; nothing is
  rewritten into a summary to make it fit.
- **Closed items fold.** Done tasks, fixed bugs, decided decisions, past
  runs: one `<details>` line with the count ("13 closed"), collapsed by
  default. Their proof is still there for whoever opens it.
- **Long lists page.** Above about fifteen rows, the table gets a filter
  box, sortable headers and paging; the rows live in the page as JSON
  and a short inline script renders them.
- **Deep material links out.** A design, a strategy, a per-file coverage
  page, a log: the page carries one link, never a second copy.

## What is not on the screen at all

- A section that restates another section in different words. Mission
  control once had next steps, a roadmap and a bug table that were the
  same rows three times; the fix was one table with a kind column, not
  better wording.
- A comparison or snapshot that will be false next week ("against
  oss", "as of commit X"). It goes in the log with its date.
- A count with no sentence, a badge with no word, a meter with no
  number. Decoration that replaces the sentence is cut.
- Decoration that does not carry reading: rounded corners, shadows,
  gradients, icons standing in for words.

## Shape of a report page (test report, audit, dashboard)

In reading order, one screen each where possible:

1. Provenance and verdict: when, against what, one sentence that says
   the situation including the bad part.
2. What is broken, worst first: a table of name, one-line message,
   whether it also failed last time, with the rerun command and the full
   message behind the row's detail.
3. The instruments: per-suite counts, durations and coverage as one
   table; each number links to the thing that produced it (the JUnit
   file, the per-file coverage HTML).
4. Deltas and history: newly failing, newly fixed, then the last runs
   folded.
5. Inventory: every test, folded, filterable.

## Shape of a tracking page (mission control)

`mission-control.md` in this folder carries the four screens: where are
we, what needs the owner, the work, the instruments. Its board rules are
the worked example of this doc.

## Checking a page against this

Open it at laptop width. For each screen ask: what is the one thing this
screen is for, is every row a short row, is every long thing behind a
click, does any number here also live somewhere else. Fix in that order.
The `scripts/guides/AUDIT_RUBRIC.md` lines for page length, long lists
and plain words are the same checks scored.
