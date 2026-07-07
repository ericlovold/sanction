# 21 — Versioning & releases

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Can anyone tell what shipped, when, and what changed — and do
consumers get warned before things break?

## Investigate

- Version identity: a meaningful version anywhere (package version actually
  bumped, git tags, releases)? Or stuck at `0.1.0` / `1.0.0` forever while the
  code churned?
- Changelog: CHANGELOG file or release notes; do entries correspond to real
  changes (spot-check against git log)? Gaps where big changes shipped silently?
- Release process: any repeatable path from commit → released artifact
  (publish workflow, release script)? For published packages: does the npm/PyPI
  version match the repo?
- Breaking-change discipline: renamed API fields, removed endpoints, or schema
  changes shipped without a major bump or migration note (cross-check topic 19).
- Rollback story: can a previous version be identified and redeployed (tags,
  platform deploy history, immutable artifacts)?

## Amateur / AI-built signals

- No tags, no releases, no changelog — history is the only record and it's
  "fix" ×200.
- A CHANGELOG written once by AI at scaffold time, never updated.
- Published package versions that skip around or never change while code does.

## Report

Write `audit/versioning.md` per the conventions template. Read-only.
