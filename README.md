# EXEGEZIS

> *Software that explains itself.*

EXEGEZIS reproduces software behavior, explains why it happens and proves when
it is fixed. Every claim it makes must trace back to evidence.

**Current stage:** Phase 0 / Iteration 2.5 — *Verification hardening*. Deterministic
observation, assertions, reproduction, Verified Bugs, compilation to standalone
Playwright tests, semantic plan validation, anchoring, timeout policy, plan
provenance and a benchmark. No AI yet. *Don't trust the model. Verify the claim.*

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

Other commands: `run` (one execution, step by step), `reproduce` (N runs,
classified), `compile` (plan → standalone `.spec.ts`), `validate` (semantic
validation against a preflight observation). See `pnpm exegezis --help`.

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
| `apps/cli` | `exegezis` command |
| `examples/buggy-shop` | Evidence lab: a shop with exactly 3 seeded bugs that its own test suite does not catch |
| `benchmarks/buggy-shop` | Benchmark dataset: symptom, reference plan, expected outcome (and compiled spec) per case |
| `docs/` | Product deep dive and engineering notes |

## Scripts

| Command | What it does |
|---|---|
| `pnpm test` | EXEGEZIS tests (incl. end-to-end verification of the 3 lab bugs) + buggy-shop conventional suite + known-bugs ground truth |
| `pnpm typecheck` | Type-checks packages, tests, the example and its compiled specs |
| `pnpm lint` | ESLint with type-aware rules |
| `pnpm verify` | All of the above |

Design notes: [docs/01-evidence-engine.md](docs/01-evidence-engine.md) (evidence and run format),
[docs/02-verification-engine.md](docs/02-verification-engine.md) (assertions, reproduction, Verified Bug, compiler) and
[docs/03-verification-hardening.md](docs/03-verification-hardening.md) (outcomes, validation, anchoring, timeouts, provenance, benchmark).
