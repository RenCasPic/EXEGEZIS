# Root cause benchmark — archived results

`2026-09-25-protocol-v2-runs5/`: `pnpm exegezis root-cause` over the 6 cases
with protocol v2 (sufficiency + A-B-A reversal + executed site + surgical
intervention), 5 runs per arm, 2 control runs per arm.

Summary: 6 cases · 6 baselines reproduced · 3 validated · 2 correct ·
**1 false validation (ADV-002)** · 3 insufficient evidence (BUG-003, ADV-003
and BUG-001-ADVERSARIAL, the last two as root cause candidates) · 18
hypotheses tested, 11 refuted.

ADV-002 is the limit of the protocol: a compensating change gated to the
failure window changes nothing where the baseline is correct, so no
behavioural experiment in the protocol can tell it from the real fix. See
docs/06-root-cause-engine.md.

Kept: `root-cause-result.json` and, per case, `root-cause-report.json`
(including the coverage footprints the decision is re-derived from),
`evaluation.json`, the `reproduction.json` of every arm (baseline, control,
interventions, reversals) and each `mutation.diff`. The attempt evidence
bundles stayed in the git-ignored `runs/` directory.

The protocol v1 results (4 cases, 1 false validation on BUG-001-ADVERSARIAL)
are in the git history at commit 6aac358.
