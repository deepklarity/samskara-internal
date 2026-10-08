# Breadcrumb index

## Flows

| Flow | Trigger | Layers | End state |
|------|---------|--------|-----------|
| [ai-review](ai-review/FLOW.md) | `samskara review <id> --ai` / `POST analyze` | cli, server, sandbox-harness, contract, web, script | grounded review persisted; failures as milestones or HTTP codes |

## Quick navigation

| Symptom | Breadcrumb |
|---------|------------|
| Agent run stuck with no output | [ai-review](ai-review/DEBUG.md) — `harness_spawning` with no `harness_first_byte` |
| Agent looping on the same command | [ai-review](ai-review/DEBUG.md) — `THRASHING` in watcher / `--peek` repeats |
| Review rejected at parse | [ai-review](ai-review/DEBUG.md) — `xml_unparseable` |
| Review rejected at grounding | [ai-review](ai-review/DEBUG.md) — `ungrounded` |
| No deliverable written | [ai-review](ai-review/DEBUG.md) — `deliverable_missing` |
| CLI poll never resolves | [ai-review](ai-review/DEBUG.md) — job `lastEvent` + `still working` |
