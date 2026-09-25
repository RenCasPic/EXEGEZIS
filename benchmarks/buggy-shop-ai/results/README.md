# Benchmark B — archived results (Phase 0, Iteration 3 checkpoint)

The runs reported in `docs/04-ai-planner.md`, frozen as the Iteration 3
experimental checkpoint. Planner: `anthropic`, model `claude-opus-5`, prompt
`planner-v1`, 10 runs per executed case.

- `2026-09-25-claude-opus-5-planner-v1-with-examples/`: leave-one-out examples, 7/7.
- `2026-09-25-claude-opus-5-planner-v1-without-examples/`: `--no-examples`, 7/7.

Only the light artifacts are kept: `benchmark-result.json` and, per case,
`plan.json` (with provenance), `generation.json` (model, prompt version,
latency, tokens, raw output), `validation.json` and `bug-report.json`. Evidence
(traces, screenshots, DOM, network) stayed in the git-ignored `runs/`
directory, so evidence paths inside the reports do not resolve here.
