# 10 — CI/CD

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Is there a pipeline that builds, tests, and ships this — and
does a red pipeline actually stop anything?

## Investigate

- Pipeline exists: workflow files (`.github/workflows/`, other CI configs).
  What runs on push/PR: build? tests? lint? typecheck?
- Gate integrity: steps that can't fail (`|| true`, `continue-on-error`),
  tests skipped or filtered down to nothing, coverage thresholds set to 0.
- Deploy path: how does code reach production — pipeline, platform auto-deploy
  (Vercel/Render), or manual? Is the deploy gated on CI passing?
- Secrets handling in CI: secrets via proper secret stores, or echoed/inline?
- Pipeline health: do recent runs pass (check via available tooling)? A CI
  that's been red for weeks scores as absent.
- Reproducibility: does CI install from the lockfile and pin runtime versions
  consistent with topic 05?

## Amateur / AI-built signals

- A workflow file copied from a template that references scripts which don't
  exist in `package.json`.
- Deploys from the author's laptop only.
- CI green because the test step runs zero tests.

## Report

Write `audit/cicd.md` per the conventions template. Read-only — never trigger
deploys or re-runs.
