# 29 — Data privacy & compliance

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Does this project know what personal data it holds, why, for how
long, and who else sees it — and could it answer a user who asks?

## Investigate

- PII inventory: walk the schema/models — what personal data is collected
  (emails, names, IPs, payment data, health/financial content)? Is any of it
  collected without an evident purpose?
- Retention & deletion: any retention policy in code or docs? Hard-delete
  paths that actually cascade (or soft-delete flags that keep everything
  forever)? Account deletion reachable by users?
- Third-party flows: enumerate where user data leaves the system (analytics,
  error trackers, LLM providers, email services, payment processors). Is each
  disclosed anywhere (privacy policy, docs)? Error trackers capturing request
  bodies with PII?
- PII in the exhaust: logs (cross-check 15), backups, audit trails — personal
  data landing where deletion can't reach it.
- Access control on PII: who/what can read it internally — admin endpoints,
  support tooling, cross-tenant leakage (cross-check 14).
- Regulatory floor: if EU/UK/California users are plausible — consent for
  tracking, privacy policy existence and accuracy, data-processing agreements
  implied by the vendor set. Special categories (health, kids, finance) raise
  the bar; flag if in scope.

## Amateur / AI-built signals

- A privacy policy page of AI lorem-ipsum promising practices the code
  contradicts.
- Analytics and session-replay on every page, no consent, no mention.
- "Delete my account" deletes the login row and orphans everything else.

## Report

Write `audit/data-privacy.md` per the conventions template. Read-only.
