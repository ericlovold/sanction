# 15 — Logging

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** When production misbehaves at 2am, do the logs reconstruct what
happened — without having leaked anything they shouldn't?

## Investigate

- Mechanism: a real logger (levels, structure) or raw `console.log`/`print`?
  Count each; where do logs go in production?
- Debug residue: leftover `console.log("here 2")`, dumped objects, commented
  log lines — the archaeology of debugging sessions.
- Signal quality: are the events that matter logged (auth failures, denials,
  payments, mutations, external-call failures)? With correlation (request ID,
  user/tenant ID) or as orphan lines?
- Leakage: secrets, tokens, passwords, full request bodies, PII in log calls —
  grep log statements for sensitive variable names. Cross-reference topic 29.
- Level discipline: everything at `info`? Errors logged as strings losing the
  stack? Log-and-rethrow duplication?

## Amateur / AI-built signals

- `console.log` as the only observability, including in production paths.
- The same event logged three times at three layers, each differently.
- Logging the entire config object, credentials included, at startup.

## Report

Write `audit/logging.md` per the conventions template. Read-only.
