# 05 — Environment management

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Can this project be set up reproducibly on a fresh machine, or
does it only work where it was written?

## Investigate

- Runtime pinning: Node/Python/etc. version declared anywhere (`.nvmrc`,
  `engines`, `.python-version`, Dockerfile, toolchain files)? Does the CI
  version match the declared one?
- Env var contract: `.env.example` present and complete? Cross-check every
  `process.env.X` / `os.environ` read in code against it. Flag vars the code
  needs that no example documents.
- Local-vs-prod divergence: hardcoded localhost URLs, paths under `/Users/…`
  or `C:\`, feature flags that only make sense on the author's machine.
- Setup path: is there a single documented command sequence from clone to
  running? Count the undocumented steps a stranger would hit (generated
  clients, DB setup, seed data).
- Containerization/dev-env: Dockerfile or devcontainer present? Does it build
  from what's committed?

## Amateur / AI-built signals

- Works only with a specific global install the docs never mention.
- `.env` committed (see topic 01) or, inversely, no example env at all.
- Absolute paths from the author's machine committed into config.

## Report

Write `audit/environment-management.md` per the conventions template. Read-only.
