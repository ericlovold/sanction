# 08 — Code review

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Does anything stand between written code and the main branch?

## Investigate

- Merge pattern: `git log --merges --oneline -30` vs. plain log — is history
  PR-shaped (merge/squash commits referencing PRs) or direct-to-main?
- Branch protection signals: CODEOWNERS file, PR templates
  (`.github/PULL_REQUEST_TEMPLATE*`), required-check hints in workflow files.
  (Actual branch-protection settings live server-side — cite what the repo
  shows and mark the limit of visibility.)
- Review depth: if PRs are visible (via available tooling), sample a few —
  rubber-stamp approvals in minutes, or substantive comments?
- Solo-project honesty: for a one-person repo, is there *any* gate (self-review
  ritual, AI review, cooling-off via PRs) or does everything land the moment
  it compiles?
- Revert/fixup ratio: frequent `fix the fix` commits suggest nothing is caught
  before merge.

## Amateur / AI-built signals

- 100% direct-to-main, including large risky changes.
- PRs opened and self-merged within the same minute.
- Fix-of-a-fix chains three deep in the log.

## Report

Write `audit/code-review.md` per the conventions template. Read-only.
