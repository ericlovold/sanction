# 24 — High availability & resilience

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Enumerate the single points of failure. What takes this system
down, and what brings it back?

## Investigate

- SPOF inventory: single region/instance/database? Third-party services
  (auth provider, LLM API, payment processor, email) whose outage stops the
  product — and whether the code degrades gracefully or hard-fails when
  they're down.
- Dependency resilience: timeouts on every outbound call (a hung dependency
  shouldn't hang the app); retries with backoff for transient failures;
  circuit-breaking or at least failure isolation on non-critical paths.
- Data durability: what data loss window exists (backup cadence, PITR)?
  Cross-check topic 18; here the question is the recovery *story*: RTO/RPO
  even informally stated? Restore path documented?
- Deploy resilience: zero-downtime deploys or a gap? Failed deploy → automatic
  rollback, or down until a human notices (cross-check 17)?
- Graceful degradation: feature flags/kill switches for risky subsystems;
  queues absorbing burst vs. synchronous chains that amplify failure.
- Platform inheritance: what does the hosting platform give (multi-AZ,
  autorestart) vs. what the architecture defeats?

## Amateur / AI-built signals

- No timeout anywhere in the codebase; every outbound call can hang forever.
- Recovery plan: redeploy and hope. Backups: assumed, never verified.
- One `.env` on one machine is the only copy of production secrets.

## Report

Write `audit/high-availability.md` per the conventions template. Read-only —
never test failover on live systems.
