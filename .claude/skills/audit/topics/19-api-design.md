# 19 — API design

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Is the API a contract a stranger could build against — coherent,
versioned, documented — or an accident of route files?

## Investigate

- Contract: OpenAPI/schema spec present? Does it match the actual routes
  (sample five endpoints against the spec)? Any docs for consumers?
- Consistency: naming (plural/singular, casing), verb semantics (GET mutating
  anything?), response envelope shape across endpoints, error shape uniformity
  (cross-check topic 13).
- Versioning & evolution: any versioning scheme (`/v1/`)? Evidence of breaking
  changes shipped without version bumps (renamed fields in git history)?
- Pagination & bounds: list endpoints paginated or unbounded? Limits on payload
  sizes, array lengths, query complexity?
- Status-code literacy: 200-with-error-body antipattern; 401 vs 403 confusion;
  201/204 where appropriate.
- Idempotency: retryable mutations (payments, provisioning) — idempotency keys
  or duplicate-execution hazards?

## Amateur / AI-built signals

- Every endpoint returns 200; errors are `{success: false}` prose.
- Three pagination styles across one API.
- The API described in the README doesn't match the routes that exist.

## Report

Write `audit/api-design.md` per the conventions template. Read-only.
