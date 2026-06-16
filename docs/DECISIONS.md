# Sanction — Decision Log (ADRs)

> Lightweight, append-only architecture/product decision records so direction changes are traceable. Format: Date · Status · Context · Decision · Consequences. Newest first. "Proposed" items need a human call (flagged ⚑).

---

## ADR-0007 ACCEPTED — Three-band spend decision + single decision engine
**Date:** 2026-06-16 · **Status:** Accepted (founder decision during QA)
**Context:** QA found `autoApproveUnderUsd` was never read by the engine (it auto-approved everything up to `escalateOverUsd`), yet the new `/policy` + templates surfaced it as a settable knob — misleading owners. Separately, the live `/authorize` path duplicated the decision gates instead of using `decide()`, a drift risk.
**Decision:** Implement a real **three-band** sizing decision in `decide()` (now the single source of truth, called inside the live advisory-locked transaction AND by dry-run):
- `amount ≤ autoApproveUnderUsd` → **approve**
- `autoApproveUnderUsd < amount ≤ escalateOverUsd` → **escalate** (human approval)
- `amount > escalateOverUsd` → **deny** (`ESCALATION_CEILING_EXCEEDED` — too large for the agent to even request)
plus the existing deny gates (no-policy, blocked category, `perTransactionMaxUsd`, daily budget). Coherent policies satisfy `autoApprove ≤ escalateOver ≤ perTransactionMax ≤ dailySpend`; `PUT /policy` now rejects incoherent threshold sets, templates were re-tuned to satisfy it, and schema defaults updated to the coherent "balanced" set (migration `..._policy_defaults_three_band`).
**Behavior change:** Mid-size charges (over `autoApproveUnder`) now **escalate** instead of silently auto-approving — strictly more conservative/safer. Verified end-to-end against a local Postgres.
**Also fixed under QA (separate P0):** `/exec` issued the JWT with a different `jti` than the `ExecutionToken` row id, so `/inject` (which looks up by the JWT's `jti`) always returned 401 — credential injection was broken in production. `issueExecutionJWT` now accepts the caller's `jti`. Caught only by the live DB smoke test; locked with a regression unit test.

## ADR-0006 ACCEPTED — Adopt the agent-team planning docs as canonical; consolidate to `docs/`
**Date:** 2026-06-15 · **Status:** Accepted
**Context:** The agent team supplied richer, market-aware `SIGNALS.md` / `BACKLOG.md` / `ROADMAP.md` (cleaner ID scheme: `SEC-/UX-/DIST-/FUND-/POS-/SIG-`; RICE + Gate model; signals my first-pass missed — MCP Registry, Connectors Directory, AgentCore, AP2/x402, prompt-injection moat, custody question). My first-pass used `S-/N-/L-/F-` ids and lived partly at repo root.
**Decision:** Adopt the team's docs as canonical, **reconciled against code** (validated/refuted each "validate against code" flag) and against what shipped in PR #1. Consolidate all four iteration docs under `docs/`; delete the root `ROADMAP.md`/`BACKLOG.md` duplicates to keep one source of truth.
**Finding→new-ID map (for traceability):** THREAT/FINDINGS `F1/F2/F3` (unauth mgmt plane) → **SEC-15** (shipped); `V2a` double-spend → **SEC-4** (shipped); `F5` cred-expiry → shipped (folded into SEC-5/SEC-8 area); `V1` key custody → **SEC-1/SEC-2**; `V2b` isolation → **SEC-3**; `F6` revocation / `F7` asymmetric → **SEC-5/SEC-10**; `F9` committed ids / key rotation → **SEC-6/SEC-16**; audit → **SEC-7**.
**Consequences:** Older docs (`SECURITY-FINDINGS.md`, `SECURITY-THREAT-MODEL.md`, `PRODUCT-OWNERSHIP.md`) still reference `F#/S#` ids; this map keeps them traceable. Future work references the `SEC-/UX-/DIST-` scheme.

## ADR-0005 ACCEPTED — Wallet rails: control plane, no custody (+ simulation mode)
**Date:** 2026-06-15 · **Status:** Accepted (founder decision, 2026-06-15)
**Context:** Sanction is marketed as an "agent wallet" but today only *authorizes* and *logs* spend; it never moves money (the `stripe` dependency is unused). Two divergent futures: (A) stay an **authorization + audit control plane** that rides existing rails (cards, agent-payment protocols), keeping Sanction out of money-transmission/PCI scope; (B) add **real spend rails** (virtual-card issuing or an agent-payment protocol) and custody/route funds, becoming a true wallet — far larger TAM but heavy compliance (MTL/KYC/PCI).
**Decision:** **(A) — control plane, no custody.** Sanction authorizes and audits spend over the developer's own rails; it does not hold or move funds. This keeps the money-transmission/PCI surface at zero and matches where the code already is. Re-open as a separate decision (B) only if a design partner needs custody. Positioning leads "give your agent a security clearance," not "Stripe for agents."
**Implementation:** Shipped **simulation mode** — `POST /authorize` accepts `dry_run: true` and returns the decision that *would* be made (with typed `code`/`remediation`) without persisting a request or consuming budget. Lets devs activate and preview policy with no funding configured, and powers the first-run dry-run UX (UX-6). Pure decision logic extracted to `lib/decisions.ts::decide()` (unit-tested); the live persisted path is unchanged (no AIIA regression).
**Consequences:** Narrative is "the spend *authorization* + credential layer," not "wallet that holds funds." GA is no longer blocked on a custody/funding integration. `stripe` dependency can be dropped in a later cleanup.

## ADR-0004 ACCEPTED — Authentication model for the management plane
**Date:** 2026-06-15 · **Status:** Accepted & implemented (branch `claude/modest-albattani-620j27`)
**Implementation:** `lib/ownerAuth.ts` (`authenticateOwner`), `sk_` management key issued once by `POST /wallets`, required (`x-mgmt-key`) on `POST/GET /agents`, `POST/GET /credentials/vault`. `GET /wallets/stats` accepts the mgmt key OR a valid agent key of the same wallet (preserves the MCP `sanction_wallet_status` tool). Pre-existing wallets fail closed and are bootstrapped via `POST /wallets/bootstrap-key` (admin-secret-gated). Data-plane endpoints (`/authorize`, `/tokens`, `/exec`, `/inject`) unchanged → no break to the live AIIA integration.
**Context:** `/wallets`, `/agents`, `/credentials/vault`, `/stats` are unauthenticated (THREAT F1–F4); `wallet_id` is non-secret. Agent `pxy_` keys are runtime credentials and must not be able to self-register siblings or manage the wallet.
**Decision:** Split planes. **Management plane** (create/list agents, manage vault & policy, read stats) requires a wallet-owner **management key** (`sk_`-style, issued once at wallet creation) or real user auth. **Data plane** (`/authorize`, `/tokens`, `/exec`, `/inject`) keeps `pxy_` agent-key / Bearer-JWT auth.
**Consequences:** API contract change for management endpoints; the live AIIA integration uses only data-plane endpoints (no break). Enables real multi-tenancy. → BACKLOG S-1.

## ADR-0003 ACCEPTED — Default-deny credential access
**Date:** 2026-06-15 · **Status:** Accepted; **allow-list flip deferred** to a follow-up
**Context:** `CredentialVault.allowedAgentIds` defaults to `[]`, interpreted as "all agents in wallet." Combined with open agent registration, this is the core of the F1 disclosure chain.
**Decision:** Flip semantics to **default-deny**: empty allow-list grants access to *no* agent; access must be explicitly granted.
**Why deferred from the first security PR:** the F1 disclosure chain is already closed by ADR-0004 (an attacker can no longer mint an agent at all). The allow-list flip touches the **data plane** (`/exec`) and would break the live AIIA integration if its credentials were stored with empty allow-lists. It needs a coordinated step: audit existing rows, backfill `allowedAgentIds`, then flip. Tracked in BACKLOG; do **not** flip blind against production.
**Consequences:** Defense-in-depth, not the primary fix; requires a data backfill before the one-line `/exec` change.

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
