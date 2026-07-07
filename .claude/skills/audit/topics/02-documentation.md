# 02 — Documentation

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Can a competent stranger set up, run, and operate this project
using only the docs — and do the docs tell the truth?

## Investigate

- README accuracy: follow it literally. Do the documented setup/run/test
  commands exist in `package.json`/`Makefile`/scripts and plausibly work?
  Do documented features exist in the code? Flag every claim that lies.
- Coverage of the essentials: prerequisites, env vars (is there a `.env.example`
  and does it match what the code actually reads?), how to run tests, how to deploy.
- Architecture docs: is there anything explaining how the pieces fit (docs/,
  ADRs, diagrams)? Or is the code the only map?
- Staleness: docs referencing files, endpoints, or commands that no longer exist.
- Audience confusion: marketing copy where operator docs should be.

## Amateur / AI-built signals

- README written by AI describing a generic project of this type rather than
  this project (features listed that were never built).
- Emoji-heavy badge-wall READMEs with no actual setup instructions.
- Docs duplicated in three places, each version different.

## Report

Write `audit/documentation.md` per the conventions template. Read-only.
