# 18 — Database management

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Is the data layer managed like the crown jewels it is — schema
evolved safely, connections pooled, data backed up?

## Investigate

- Migrations: a real migration system with committed history, or schema drift
  by hand / `db push` / "sync" in production? Do migrations run automatically
  and is that path guarded against running on the wrong database?
- Backups & recovery: any evidence of backup strategy (platform PITR,
  dump jobs, docs)? Has restore ever been tested? (Docs claim ≠ proof — mark
  the visibility limit.)
- Connection handling: pooling appropriate to the platform (serverless needs
  a pooler or driver adapter); connections leaked (opened per request, never
  closed); pool sizes vs. platform limits.
- Schema quality: indexes on hot lookups and foreign keys; sane types (money
  as float is a Critical); constraints (NOT NULL, unique, FK) enforced in the
  DB or only hoped for in app code.
- Query safety: N+1 patterns in hot paths (overlaps 23 — note, don't re-score);
  unbounded queries without pagination/limits; transactions around multi-step
  writes.
- Access: app connecting as superuser/owner where a limited role should exist;
  RLS/tenant isolation if multi-tenant.

## Amateur / AI-built signals

- No migrations directory; the schema exists only in production.
- Floats for money; strings for everything else.
- The prod DB URL in code, and the app connecting as `postgres`.

## Report

Write `audit/database-management.md` per the conventions template. Read-only —
never run migrations or writes; schema inspection only.
