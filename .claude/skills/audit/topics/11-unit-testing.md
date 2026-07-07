# 11 — Unit testing

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Do tests exist, do they assert anything, and would they catch a
regression in the code that matters?

## Investigate

- Existence and shape: locate test files; ratio of test files to source
  modules; which critical modules (auth, money, policy, parsing) have *zero*
  tests.
- Assertion quality: sample 10 tests. Flag assertion-free tests (call the
  function, assert nothing), tautologies (`expect(true).toBe(true)`), tests of
  mocks rather than behavior, snapshot tests nobody could review.
- Run them: execute the test suite read-only. Do they pass? How long? Any
  skipped/`.only` residue committed?
- Coverage: run coverage if configured; otherwise estimate by mapping tests to
  modules. Note thresholds and whether they're a ratchet or a rubber stamp.
- Edge discipline: do tests cover failure paths (bad input, boundary values,
  rejected promises) or only the happy line?

## Amateur / AI-built signals

- AI-generated test files asserting the mock returned what the mock was told
  to return.
- A tests/ directory with one example.test file from the scaffold.
- Tests that fail when run — committed red.

## Report

Write `audit/unit-testing.md` per the conventions template. Read-only — run
tests, never modify them.
