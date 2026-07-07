# 12 — Integration testing

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Does anything test the seams — code + database, service + service,
route + auth + persistence — where unit tests can't see?

## Investigate

- Existence: integration/e2e test layers (DB-backed tests, API tests hitting
  real handlers, browser tests). How are they gated/run — locally, CI, never?
- Seam coverage: map the system's real seams (DB transactions, external APIs,
  auth middleware chain, queues) and check which have any test at all.
- Fidelity: do integration tests use a real dependency (ephemeral Postgres,
  test container) or mock the very seam they claim to test?
- The concurrency/atomicity class: money, counters, uniqueness — is anything
  tested under parallel access, or only single-threaded happy path?
- Smoke path: any end-to-end proof a deployed instance works (smoke script,
  health-check suite)?

## Amateur / AI-built signals

- Everything mocked, everywhere — the system has never been tested assembled.
- An e2e framework installed and configured with zero specs.
- Integration failures "fixed" by widening mocks instead of fixing code.

## Report

Write `audit/integration-testing.md` per the conventions template. Read-only.
