# EXEGEZIS

> *Software that explains itself.*

EXEGEZIS reproduces software behavior, explains why it happens and proves when
it is fixed. Every claim it makes must trace back to evidence.

**Current stage:** Phase 0 / Iteration 1 — *Evidence Engine*. Deterministic
observation of web apps, no AI yet. *Evidence first. Intelligence later.*

## Quick start

Requirements: Node.js ≥ 22.18, pnpm 10.

```bash
pnpm install
pnpm --filter @exegezis/adapter-browser exec playwright install chromium
pnpm test

pnpm --filter buggy-shop dev          # http://localhost:3000
pnpm exegezis observe --url http://localhost:3000 --output ./runs
```

Reproduce a known bug from a plan (actions as data):

```bash
pnpm exegezis observe --url http://localhost:3000 \
  --actions examples/buggy-shop/scenarios/bug-002-coupon-quantity.json
```

Open a run's trace:

```bash
pnpm --filter @exegezis/adapter-browser exec playwright show-trace <absolute-path-to>/runs/<runId>/trace.zip
```

## Layout

| Path | Responsibility |
|---|---|
| `packages/core` | Zod schemas (source of truth), actions as data, adapter contract, run recorder, plan executor, redaction, structured logging |
| `packages/adapter-browser` | Playwright/Chromium adapter: actions, observations, console, network, accessibility, screenshots, trace |
| `apps/cli` | `exegezis` command |
| `examples/buggy-shop` | Evidence lab: a shop with exactly 3 seeded bugs that its own test suite does not catch |
| `docs/` | Product deep dive and engineering notes |

## Scripts

| Command | What it does |
|---|---|
| `pnpm test` | EXEGEZIS tests + buggy-shop conventional suite + known-bugs ground truth |
| `pnpm typecheck` | Type-checks packages, tests and the example |
| `pnpm lint` | ESLint with type-aware rules |
| `pnpm verify` | All of the above |

See [docs/01-evidence-engine.md](docs/01-evidence-engine.md) for the run format and design decisions.
