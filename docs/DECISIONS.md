# Sanction — Decision Log (ADRs)

> Lightweight, append-only architecture/product decision records so direction changes are traceable. Format: Date · Status · Context · Decision · Consequences. Newest first. "Proposed" items need a human call (flagged ⚑).

---

## ADR-0005 ⚑ PROPOSED — Wallet rails: control plane vs. fund custody
**Date:** 2026-06-15 · **Status:** Proposed (needs founder decision)
**Context:** Sanction is marketed as an "agent wallet" but today only *authorizes* and *logs* spend; it never moves money (the `stripe` dependency is unused). Two divergent futures: (A) stay an **authorization + audit control plane** that rides existing rails (cards, agent-payment protocols), keeping Sanction out of money-transmission/PCI scope; (B) add **real spend rails** (virtual-card issuing or an agent-payment protocol) and custody/route funds, becoming a true wallet — far larger TAM but heavy compliance (MTL/KYC/PCI).
**Decision:** Deferred to founder. Recommendation: **(A) for now** — it is where the current code already is, keeps regulatory surface minimal, and the differentiated value (scoped credential injection + policy) doesn't require custody. Re-open if a design partner needs custody.
**Consequences:** Narrative shifts from "wallet that holds funds" to "the spend *authorization* and credential layer" until/unless (B) is chosen.

## ADR-0004 PROPOSED — Authentication model for the management plane
**Date:** 2026-06-15 · **Status:** Proposed
**Context:** `/wallets`, `/agents`, `/credentials/vault`, `/stats` are unauthenticated (THREAT F1–F4); `wallet_id` is non-secret. Agent `pxy_` keys are runtime credentials and must not be able to self-register siblings or manage the wallet.
**Decision:** Split planes. **Management plane** (create/list agents, manage vault & policy, read stats) requires a wallet-owner **management key** (`sk_`-style, issued once at wallet creation) or real user auth. **Data plane** (`/authorize`, `/tokens`, `/exec`, `/inject`) keeps `pxy_` agent-key / Bearer-JWT auth.
**Consequences:** API contract change for management endpoints; the live AIIA integration uses only data-plane endpoints (no break). Enables real multi-tenancy. → BACKLOG S-1.

## ADR-0003 ACCEPTED — Default-deny credential access
**Date:** 2026-06-15 · **Status:** Accepted (implementation pending, S-2)
**Context:** `CredentialVault.allowedAgentIds` defaults to `[]`, interpreted as "all agents in wallet." Combined with open agent registration, this is the core of the F1 disclosure chain.
**Decision:** Flip semantics to **default-deny**: empty allow-list grants access to *no* agent; access must be explicitly granted. (Migration note: existing rows relying on empty=all must be backfilled.)
**Consequences:** Safer default; small migration; one-line logic change in `/exec` and clearer vault UX.

## ADR-0002 ACCEPTED — Keep symmetric crypto for MVP, plan envelope encryption
**Date:** 2026-06-15 · **Status:** Accepted
**Context:** Single global HS256 JWT secret and one AES-256-GCM key (`sha256(env)`) for all tenants; no rotation, no KMS (THREAT F7).
**Decision:** Acceptable for MVP/single-tenant. **Plan** envelope encryption with a KMS master key + per-credential `keyId` for rotation (and per-wallet data keys for blast-radius isolation) before onboarding external tenants with real secrets. → BACKLOG L-1.
**Consequences:** Tech debt acknowledged; ciphertext format will need a `keyId` prefix when L-1 lands.

## ADR-0001 ACCEPTED — Two-step scoped credential injection (exec → inject)
**Date:** 2026-06-15 (documenting existing design) · **Status:** Accepted
**Context:** Agents need third-party secrets at runtime without those secrets living in prompts/logs/env.
**Decision:** Issue a short-lived (≤60 min, default 15 min) scoped HS256 JWT via `/exec` (persisted as `ExecutionToken` keyed by `jti`); release a decrypted credential only via `/inject` against a valid in-scope, unexpired, unrevoked token, writing a `CredentialInjection` audit row each time.
**Consequences:** This is Sanction's differentiated core and is well-built. Gaps to close: enforce credential `expiresAt`, enforce per-execution budget, add revocation (F5, F6, F8).
