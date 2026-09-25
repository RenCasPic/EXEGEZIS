# EXEGEZIS

> *Software that explains itself.*

EXEGEZIS reproduces software behavior, explains why it happens and proves when
it is fixed. Every claim it makes must trace back to evidence.

**Current stage:** Phase 0 — *Root cause by intervention*. A planner (LLM)
turns a user's symptom into a TestPlan and the deterministic Verification
Engine decides whether the bug is real. For a verified bug, competing
hypotheses are tested by applying each one's code mutation to an isolated copy
of the app: a cause is VALIDATED only if its intervention removed the bug in
every run and its alternatives were refuted. *The AI proposes. EXEGEZIS
decides whether the evidence proves the claim.*

## Quick start

Requirements: Node.js ≥ 22.18, pnpm 10.

```bash
pnpm install
pnpm --filter @exegezis/adapter-browser exec playwright install chromium
pnpm test

pnpm --filter buggy-shop dev          # http://localhost:3000
pnpm exegezis observe --url http://localhost:3000 --output ./runs
```

Verify a known bug (plan → 10 isolated runs → compiled Playwright spec → report):

```bash
pnpm exegezis verify --plan benchmarks/buggy-shop/cases/BUG-001/plan.json --runs 10
```

Run the benchmark (3 bugs that must be VERIFIED, 6 negative cases that must never be):

```bash
pnpm benchmark
```

From a symptom, with the AI planner (needs `ANTHROPIC_API_KEY`; `--planner mock`
replays recorded answers for tests):

```bash
pnpm exegezis ai-verify --symptom "After I remove the only item from my cart, the cart counter still says one item." --runs 10
```

```bash
pnpm exegezis benchmark --suite buggy-shop-ai --planner anthropic
```

Other commands: `generate-plan` (symptom → validated plan, not executed), `run` (one execution, step by step), `reproduce` (N runs,
classified), `compile` (plan → standalone `.spec.ts`), `validate` (semantic
validation against a preflight observation). See `pnpm exegezis --help`.

Root cause by intervention (each hypothesis' code mutation runs on an isolated
copy of the app; a cause is VALIDATED only if it removes the bug in every run
and its alternatives are refuted):

```bash
pnpm exegezis root-cause                 # benchmarks/buggy-shop-root-cause, 5 runs per arm
```

Browse everything in the local web UI (reads `runs/` and the archived benchmark
results; no demo data):

```bash
pnpm web                              # http://127.0.0.1:4100
```

Open a run's trace:

```bash
pnpm --filter @exegezis/adapter-browser exec playwright show-trace <absolute-path-to>/runs/<runId>/trace.zip
```

## Layout

| Path | Responsibility |
|---|---|
| `packages/core` | Zod schemas (source of truth): actions, assertions, test plans, evidence, reproduction, verification; run recorder, plan executor, reproduction loop, bug reports, redaction, structured logging |
| `packages/adapter-browser` | Playwright/Chromium adapter: actions, assertion evaluators, observations, console, network, accessibility, screenshots, trace |
| `packages/compiler-playwright` | Test plan → standalone Playwright spec; runs specs with the standard Playwright runner |
| `packages/planner` | Symptom → TestPlan proposal (provider-agnostic `PlanGenerator`, Anthropic and mock providers, versioned prompt). Never decides verdicts; core does not depend on it |
| `apps/cli` | `exegezis` command |
| `apps/web` | Local UI (Next.js): investigations, reproductions, evidence, AI plans, root causes, benchmarks. Reads run artifacts with the core schemas; stages not built yet (fix, fix verification) are shown as NOT IMPLEMENTED |
| `examples/buggy-shop` | Evidence lab: a shop with exactly 3 seeded bugs that its own test suite does not catch |
| `benchmarks/buggy-shop` | Benchmark A: human-authored plans — symptom, reference plan, expected outcome (and compiled spec) per case |
| `benchmarks/buggy-shop-ai` | Benchmark B: plans generated from symptoms by a planner; results and metrics kept separate |
| `benchmarks/buggy-shop-root-cause` | Root-cause benchmark: competing hypotheses with a code mutation each (engine input) and an independent ground truth (evaluation only) |
| `docs/` | Product deep dive and engineering notes |

## Scripts

| Command | What it does |
|---|---|
| `pnpm test` | EXEGEZIS tests (incl. end-to-end verification of the 3 lab bugs) + buggy-shop conventional suite + known-bugs ground truth |
| `pnpm typecheck` | Type-checks packages, tests, the example and its compiled specs |
| `pnpm lint` | ESLint with type-aware rules |
| `pnpm verify` | All of the above |
| `pnpm web` | Builds the packages and starts the local UI on 127.0.0.1:4100 |
| `pnpm build:web` | Production build of the UI |

Design notes: [docs/01-evidence-engine.md](docs/01-evidence-engine.md) (evidence and run format),
[docs/02-verification-engine.md](docs/02-verification-engine.md) (assertions, reproduction, Verified Bug, compiler),
[docs/03-verification-hardening.md](docs/03-verification-hardening.md) (outcomes, validation, anchoring, timeouts, provenance, benchmark) and
[docs/04-ai-planner.md](docs/04-ai-planner.md) (planner, providers, prompt, benchmark B) and
[docs/05-web-ui.md](docs/05-web-ui.md) (local UI, data sources, what is not implemented) and
[docs/06-root-cause-engine.md](docs/06-root-cause-engine.md) (root cause by intervention: criterion, experiments, isolation, benchmark).
