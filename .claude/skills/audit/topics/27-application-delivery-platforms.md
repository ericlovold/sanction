# 27 — App-delivery platforms (PaaS)

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** If this runs on Vercel/Netlify/Render/Railway/Fly/Heroku-class
platforms — does the code respect the platform's physics?

If the project doesn't deploy to a PaaS, say so, score N/A with a one-line
report, and stop.

## Investigate

- Ephemerality: writes to local disk expected to persist (uploads, SQLite,
  caches, sessions on disk) on platforms that wipe or shard the filesystem.
- Execution limits: work that can exceed function timeouts (long LLM calls,
  big exports) without queueing/streaming/background strategy; cold-start
  sensitivity on latency-critical paths.
- Connection physics: serverless × database connections — pooler/adapter in
  place or connection exhaustion waiting to happen (cross-check topic 18).
- Config location: how much lives only in the platform dashboard vs. committed
  config (cross-check topic 20)? Preview/staging environments sharing
  production secrets or database?
- Client/server secret boundary: framework-specific leaks — server env vars
  exposed via client-bundle prefixes (`NEXT_PUBLIC_`, `VITE_`), secrets in
  client-reachable code, API keys shipped to the browser.
- Platform features unused where needed: cron, queues, KV — home-rolled
  fragile versions of things the platform provides.

## Amateur / AI-built signals

- SQLite or file-session storage on a serverless platform.
- `NEXT_PUBLIC_API_SECRET`.
- A 5-minute job crammed into a 10-second function timeout, "usually works."

## Report

Write `audit/application-delivery-platforms.md` per the conventions template.
Read-only.
