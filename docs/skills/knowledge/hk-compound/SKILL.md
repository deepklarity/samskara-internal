---
name: hk-compound
description: "Compound a learning into a reusable pattern in docs/patterns/. Use after solving a non-trivial problem, discovering a principle worth reusing, or hitting a gotcha that would bite someone else. Triggers on: 'capture this learning', 'that was tricky', 'compound this', 'let's compound this', 'what did we learn', or /hk-compound."
argument-hint: "[optional: brief context about what to capture]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# /hk-compound — Capture a Reusable Pattern

Extract the transferable principle from what just happened and save it to `docs/patterns/`.

## Context hint

<context_hint> $ARGUMENTS </context_hint>

If the context hint is empty, scan the conversation for the most significant non-obvious learning.

## Process

### Step 1: Extract the pattern

From the conversation, identify:

1. **Pattern name**: Short, memorable (e.g., "Guard Before Flag", "Batch Then Validate")
2. **Principle**: 1-3 sentences. The reusable insight, stated so someone unfamiliar could apply it.
3. **Signal**: How you recognise the situation. Leave it out when one instance does not show it yet.
4. **This instance**: What happened — error messages, file paths, the fix. A few lines.
5. **Tags**: 3-5 lowercase hyphenated keywords.

If there's no transferable principle (just "we fixed X by doing Y"), tell the user and stop.

### Step 2: Check for existing patterns

```bash
grep -ril "<keyword>" docs/patterns/
```

- **Match found**: Append instance to existing file under `## Instances`. Update principle/signal if the new instance sharpens them.
- **No match**: Create new file.

### Step 3: Write or update the pattern

**Path**: `docs/patterns/<slug>.md` — a pattern is a living doc: one file per principle, no date in the name, updated in place as instances accumulate.

**Format**:

```markdown
tags: tag-one, tag-two, tag-three

# <Pattern Name>

<The principle. 1-3 clear sentences.>

## Signal

<How to recognize you're in this situation.>

## Instances

- **<short label>**: What happened. Specifics: errors, fix, files. Few lines.
```

### Step 4: Report

```
Done — docs/patterns/<filename>.md
<1-sentence summary>
```
