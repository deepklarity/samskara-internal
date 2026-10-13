All agent and contributor guidance lives in [CLAUDE.md](CLAUDE.md) — same rules for every
harness and human: setup, worktrees, database, logging, releases, and the TDD convention.

Orientation docs, in reading order:

1. [CLAUDE.md](CLAUDE.md) — contributor conventions (the entry point)
2. [docs/project_understanding.md](docs/project_understanding.md) — why this repo exists
3. [writeup/self-learning/RESUME.md](writeup/self-learning/RESUME.md) — where the current
   long-running initiative stands; read this before continuing any work described there
4. [README.md](README.md) — running the server, CLI, and web UI
5. [docs/playbook/](docs/playbook/) — imported playbooks (mission control, tenets, testing)

Skills live in `.claude/skills/` but their substance is tool-agnostic; any agent can follow
them.

If a task asks you to control Herdr (panes, workspaces, or other coding agents) or to
delegate work to other agents via Herdr, and no Herdr skill is already in your context,
read [`.claude/skills/herdr/SKILL.md`](.claude/skills/herdr/SKILL.md) first and follow it.
It teaches the `herdr` CLI: inspecting panes, starting agents, prompting them, reading
output, and waiting for completion. This applies to every harness (Claude Code, Codex,
OpenCode, and others).

### Choosing an agent's model — pass a flag, never ask the agent to switch

A model is set when the agent starts, by passing the harness's own flag after `--`:

```bash
herdr agent start audit --kind opencode --pane "$PANE" -- --model opencode/nemotron-3.5-lightning-free
```

- **Do not tell an agent to run `/model`.** That is a UI action in the TUI; the agent
  cannot perform it and will stall on the picker. Same for any other TUI-only command.
- `opencode` accepts `-m, --model provider/model`; `codex`/`claude` take their own flags.
  Check `opencode --help` (or `herdr agent --help`) before guessing a flag name.
- **Free-plan working models here:** `opencode/nemotron-3.5-lightning-free`,
  `opencode/muse-spark-1.3-contributor-free`. `glm-5.3-flash` /
  `zai-coding-plan/glm-5.3-flash` return a server-side `UnknownError` on every request —
  do not build a flow around them.
- Verify what the agent actually got with `herdr agent read <name> --source visible`
  (the status line names the model), not by asking it.
