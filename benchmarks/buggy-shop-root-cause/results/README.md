# Root cause benchmark — archived results

`2026-09-25-runs5/`: `pnpm exegezis root-cause` over the 4 cases, 5 runs per arm.
Summary: 4 cases · 4 baselines reproduced · 3 validated · 2 correct ·
**1 false validation** (BUG-001-ADVERSARIAL, by design) · 1 insufficient
evidence (BUG-003) · 12 hypotheses tested, 7 refuted.

Kept: `root-cause-result.json` and, per case, `root-cause-report.json`,
`evaluation.json`, the baseline and each experiment's `reproduction.json`, and
each `mutation.diff`. The attempt evidence bundles stayed in the git-ignored
`runs/` directory. See docs/06-root-cause-engine.md.
