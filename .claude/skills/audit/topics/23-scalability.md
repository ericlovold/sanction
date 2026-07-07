# 23 — Scalability

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** What breaks first when 10× the load arrives — and does anyone
know that number?

## Investigate

- Hot-path economics: trace the highest-traffic endpoints. Per-request work:
  N+1 query patterns (loops issuing queries), sequential awaits that could be
  parallel, unbounded `findMany`/SELECT without limits, full-table scans
  implied by missing indexes (cross-check topic 18).
- Payload discipline: responses returning entire tables; images/assets
  unoptimized; no compression.
- Caching: any caching layer where reads dominate (HTTP cache headers, CDN
  usage, memoization, Redis)? Cache invalidation story if present?
- State & horizontal scaling: in-process state (sessions in memory, local file
  writes, in-memory queues/cron) that breaks with a second instance or a
  serverless platform's ephemerality.
- Concurrency safety under load: read-modify-write races on counters/budgets/
  inventory without transactions or locks.
- Limits awareness: platform ceilings (connection counts, function timeouts,
  rate limits) vs. what the code assumes. Any load testing evidence at all?

## Amateur / AI-built signals

- `await` inside a for-loop over a database table.
- Everything fetched, filtered in JavaScript.
- Sessions in a module-level Map on a serverless platform.

## Report

Write `audit/scalability.md` per the conventions template. Read-only — no load
generation against live systems.
