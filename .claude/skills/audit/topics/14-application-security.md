# 14 — Application security

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Would this survive its first curious attacker? (OWASP Top 10
lens, evidence from code — this is a code audit, not a pentest.)

## Investigate

- Injection: SQL built by string concatenation/template literals vs.
  parameterized/ORM; command execution with user input; path traversal in file
  handling; unsafe deserialization.
- AuthN: password storage (bcrypt/argon2 vs. anything else), session/JWT
  handling (algorithm pinned? expiry? secret strength/source), credential
  comparison timing.
- AuthZ: per-route access control — find endpoints missing the auth check
  their siblings have; object-level checks (can user A fetch user B's record
  by ID?); tenant isolation if multi-tenant.
- Secrets: hardcoded keys/tokens in source or client-shipped code (topic 01
  covers history; HEAD is in scope here). Client/server boundary: server env
  vars leaking into client bundles.
- Web layer: CORS policy, security headers, CSRF posture for cookie-based
  auth, SSRF in URL-fetching features, rate limiting on auth and expensive
  endpoints.
- Crypto: home-rolled anything, ECB/static-IV misuse, `Math.random` for tokens.

## Amateur / AI-built signals

- Auth middleware present but not applied to half the routes.
- `verify: false` / `rejectUnauthorized: false` / JWT `alg: none` anywhere.
- Security-looking code copied in but never wired to anything.

## Report

Write `audit/application-security.md` per the conventions template. Findings
here default to High/Critical severity — justify anything lower. Read-only:
no exploitation, no traffic against live systems.
