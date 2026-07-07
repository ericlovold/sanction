# 07 — Linting & formatting

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Is style enforced by tooling, or by hope?

## Investigate

- Tooling present: linter and formatter configs (ESLint, ruff, prettier, etc.),
  and — critically — are they *run* anywhere (scripts, CI, hooks)?
- Actually clean: run the configured linter read-only. Count errors/warnings.
  A committed config with 400 violations scores lower than no config at all
  pretending nothing.
- Suppression abuse: count `eslint-disable`, `# noqa`, `@ts-ignore`,
  `@ts-expect-error`, `any` casts. Sample a few — justified or silencing?
- Consistency without tooling: mixed quotes/indentation/semicolons across
  files; naming conventions that flip per module.
- Dead code: unused exports, unreachable branches, commented-out blocks left
  in place, orphaned files nothing imports.

## Amateur / AI-built signals

- Blocks of commented-out previous attempts left above the working version.
- `@ts-ignore`/`any` sprinkled wherever types got hard.
- Three formatting styles corresponding to three different AI sessions.

## Report

Write `audit/linting.md` per the conventions template. Read-only — run linters
in check mode only, never `--fix`.
