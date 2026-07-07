# 09 — Remote (automated) code review

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Does any automation review changes before merge — bots, static
analysis, AI reviewers — or is human attention (topic 08) the only net?

## Investigate

- CI-integrated review: static analysis / SAST steps in workflow files
  (CodeQL, semgrep, sonar, dependency-review-action), lint gates that block.
- Review bots: config for AI/automated reviewers (Copilot review, coderabbit,
  reviewdog, danger) in workflows or dotfiles.
- Secret scanning & pre-commit: gitleaks/trufflehog in CI, husky/pre-commit
  hooks committed and installed by setup.
- Do the gates bind? A workflow that runs but whose failure doesn't block
  merge is decoration — check for `continue-on-error`, `|| true`, and whether
  checks are plausibly required.
- Coverage of the dangerous surface: does automation look at the auth,
  payment, or data paths, or only formatting?

## Amateur / AI-built signals

- No automation of any kind between editor and main.
- A linter workflow with `continue-on-error: true` — green forever.
- Security-scan workflow added by a template, never triggered.

## Report

Write `audit/remote-code-review.md` per the conventions template. Read-only.
