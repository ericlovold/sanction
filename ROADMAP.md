# Sanction — Roadmap

> Living document (now / next / later). Re-evaluated every cycle against `docs/SIGNALS.md`. Detailed scoring in `BACKLOG.md`; direction changes logged in `docs/DECISIONS.md`. Every PR should state the user-facing change and the signal it answers.

## Now — "Make it safe and true" (this is the gate to everything else)
The product currently claims more than it enforces, and four endpoints are unauthenticated (one is a live credential-disclosure path). Until this is closed, nothing else matters.
- **Lock the management plane** — authentication on `/wallets`, `/agents`, `/credentials/vault`, `/stats` (BACKLOG S-1).
- **Default-deny credential access** + enforce credential expiry on injection (S-2).
- **Token revocation** kill-switch (S-3).
- **Hygiene**: scrub live ids, rotate the AIIA key, add `.env.example`, finish the AutoFlux→Sanction rename, fix the dashboard env var (S-4, S-7).
- **CI + first tests** so safety is regression-proof (S-5, S-6).
- **Honest narrative**: trim README claims to what's enforced (clearance, per-execution budget, monthly budget, pricing are aspirational today).

## Next — "Close the narrative gap"
Make the headline knobs real and reduce integration friction.
- **Policy & escalation as a product**: policy management API, escalation approve/deny (N-1, N-2).
- **Enforce the promises**: per-execution budget, monthly budget, and either enforce clearance or cut it from the story (N-3, N-4, N-6).
- **Reduce friction**: TS + Python SDK that encode exec→inject correctly; owner console (N-5, N-7).

## Later — "Earn enterprise trust & monetize"
- **Key management**: envelope encryption + KMS, per-credential key ids, rotation (L-1).
- **Audit you can defend**: tamper-evident/append-only audit (L-2).
- **Abuse controls**: rate limits + quotas (L-3).
- **Monetization**: wire billing, enforce tiers (L-4).
- **Compliance**: SOC 2 readiness (L-5).
- **Strategic fork** (needs human decision, see DECISIONS): whether to add **real spend rails** (virtual cards / agent-payment protocol) and become a true wallet, or stay the authorization+audit control plane that rides others' rails (L-6).

## Guiding theses (revisit each cycle)
1. The wedge is **developers building agents that must act**, reached through the **MCP/A2A ecosystem** — not enterprise security buyers first.
2. Sanction's defensible core is **scoped, short-lived, audited credential injection** + **policy-gated authorization**. Double down there before broadening.
3. "Security product" means polish and proof are features: tests, SOC 2, clean naming, and no over-claiming are roadmap items, not afterthoughts.
