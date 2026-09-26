# EXEGEZIS

> *Software that explains itself.*

EXEGEZIS reproduces software behavior, explains why it happens and proves when
it is fixed. Every claim it makes must trace back to evidence.

**Current stage:** Phase 0 — *Root cause by intervention*. A planner (LLM)
turns a user's symptom into a TestPlan and the deterministic Verification
Engine decides whether the bug is real. For a verified bug, competing
hypotheses are tested by applying each one's code mutation to an isolated copy
of the app: a cause is VALIDATED only if its intervention removed the bug in
every run, reverting it brings the bug back, the modified code ran in the
failing scenario, the change is surgical (execution coverage shows nothing
changes where the app was already correct) and its alternatives were refuted.
Otherwise the survivor is reported as a root cause candidate. Known limit: a
compensating change gated to the failure window still passes (ADV-002). *The AI proposes. EXEGEZIS
decides whether the evidence proves the claim.*

## Quick start

Requirements: Node.js ≥ 22.18, pnpm 10, and a Chromium-based browser:
Playwright's Chromium (reference), or Google Chrome, or Microsoft Edge (comes
with Windows). EXEGEZIS never downloads a browser on its own.

Windows (CMD):

```bat
pnpm install
pnpm build
pnpm exegezis doctor
```

macOS / Linux:

```bash
pnpm install
pnpm build
pnpm exegezis doctor
```

`exegezis doctor` checks Node.js, pnpm and each browser with its version, says
which one EXEGEZIS will use and what to install if something is missing. To
download Playwright's Chromium (~150 MB) — only when you ask for it — run
`pnpm exegezis doctor --install` (the same command in CMD, PowerShell, macOS
and Linux).

Every browser command takes `--browser-channel auto|chromium|chrome|msedge`.
`auto` (default) uses Playwright's Chromium if it is installed, otherwise
Chrome, otherwise Edge; the browser actually used (channel and version) is
recorded in every run and shown in the UI. If no browser can start, the command
stops at once with **ENGINE_ERROR** (exit code 7) and says how to fix it: a
browser that cannot start on this computer is never reported as a problem of
the site (UNREACHABLE) or of the application (INCONCLUSIVE, NOT VERIFIED).

```bash
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

Inspect a web page without a symptom (read-only, same origin, deterministic
checks: JS exceptions, console errors, failed requests, broken internal links,
axe WCAG 2.1 AA, mixed content, SEO basics as info). A finding is VERIFIED only
if it appears in every run (`--runs`, default 3), in fresh browsers; the others
are reported apart as INTERMITTENT. Each VERIFIED finding keeps its evidence
and a standalone Playwright spec that fails while the problem exists:

```bash
pnpm exegezis inspect --url http://localhost:3000/
pnpm exegezis inspect --url https://example.com/ --max-pages 1
```

Options: `--max-pages 20`, `--max-depth 2`, `--runs 3`, `--checks a11y,broken-links`,
`--storage-state <file>`, `--strict-readonly` (also block the writes the page
itself makes; those pages become DEGRADED and their findings are discarded),
`--ignore-robots`, `--browser-channel`. The inspection never submits forms, clicks non-link elements
or types; it only issues GET/HEAD requests of its own. Writes made by the page
itself are listed in the report. External domains are listed, never visited.
Requests carry the User-Agent `EXEGEZIS-Inspector/<version>`. A site that shows
a CAPTCHA, anti-bot page or login wall is reported BLOCKED; nothing tries to
get around it. Inspect only sites you own or are allowed to test. Results go to
`runs/inspections/<id>/inspection-report.json` (verdicts and counts are
re-derived from the raw observations when the report is loaded). Design:
[docs/07-web-inspection.md](docs/07-web-inspection.md). Generic checks do not
find logic bugs such as buggy-shop's: that is what `verify`, `ai-verify` and
`root-cause` are for.

Browse everything in the local web UI (reads `runs/` and the archived benchmark
results; no demo data):

```bash
pnpm web                              # http://127.0.0.1:4100
```

The home page (`/`) inspects a site: a URL field, the options folded away, and
a one-line permission confirmation before the first inspection of an external
host. It starts the real CLI as a job (one inspection at a time, the rest
queued) and follows its progress. Below it, what has been proven (one value per
case, replays of recorded planner answers never counted), activity per case,
recent inspections and the stages EXEGEZIS can prove today. The previous
dashboard is at `/overview`; reports at `/inspections/<id>`. Light, dark or
system theme (top bar). Design system: [docs/08-design-system.md](docs/08-design-system.md).

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
