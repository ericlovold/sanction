# 16 — Observability

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Beyond logs — can anyone see this system's health from outside it?

## Investigate

- Health surface: liveness/readiness endpoints; do they check real
  dependencies (DB ping) or return hardcoded `ok`?
- Metrics: any instrumentation (Prometheus, StatsD, platform analytics) for
  request rates, latency, error ratios, queue depths? Business-level counters?
- Tracing: request/correlation IDs propagated through layers and into logs?
  Distributed tracing if there are multiple services?
- Error tracking: Sentry/equivalent wired in — with an actual DSN path, not
  just the dependency installed?
- Platform reliance: if hosted on a PaaS, what does the platform give for free
  vs. what's actually configured? "Vercel has logs" is not a strategy — is
  anything retained, searchable, alertable?

## Amateur / AI-built signals

- Zero visibility beyond stdout on a system with real users.
- An APM SDK in the manifest, initialized nowhere.
- A `/health` endpoint returning `{status: "ok"}` unconditionally — including
  when the database is down.

## Report

Write `audit/observability.md` per the conventions template. Read-only.
