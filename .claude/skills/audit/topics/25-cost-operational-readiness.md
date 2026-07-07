# 25 — Cost & operational readiness

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Can this be operated by a real team (or a real solo founder) at
a bill that won't surprise anyone?

## Investigate

- Runaway-cost surfaces: unbounded loops calling paid APIs (LLM calls
  especially — cross-check topic 28), per-request work that scales with
  attacker-controlled input, storage/egress growth with no cleanup, cron jobs
  multiplying, missing pagination pulling entire datasets repeatedly.
- Spend guardrails: budget alerts/caps at the platform (documented or in IaC),
  rate limits protecting paid endpoints, quotas per user/tenant.
- Cost visibility: any accounting of what a request/user/month costs? Metering
  in code or platform?
- Operability: can someone other than the author deploy, roll back, rotate a
  secret, or restore data using written docs? Runbooks for the top three
  failure modes? Bus factor honestly assessed.
- Right-sizing: paying for idle (oversized instances, always-on for bursty
  load) or under-provisioned for stated goals.

## Amateur / AI-built signals

- A paid API called in a retry loop with no cap — the classic $3,000 weekend.
- No idea what the monthly bill is or why.
- Operations = "Eric knows"; nothing written down.

## Report

Write `audit/cost-operational-readiness.md` per the conventions template.
Read-only.
