# Sanction — Backlog (RICE-scored)

> Canonical backlog. Adopted from the agent-team draft and **reconciled against the code** (2026-06-15) + against what shipped in PR #1. Re-score as discovery and `SIGNALS.md` change the inputs.
>
> **🔎 Code-validation of the draft's open questions:**
> - `/authorize` **did** race (TOCTOU confirmed) → **SEC-4 shipped in PR #1**.
> - Master key = **single Vercel env var**, no envelope/rotation → **SEC-1 confirmed open**.
> - **No fund custody exists** — `stripe` imported but unused; budgets are accounting caps over the dev's own rails → **FUND-1 current-state resolved** (formalize in ADR-0005).
> - The draft missed a **live unauthenticated-management-plane P0** found in code → added as **SEC-15 (shipped PR #1)**.
>
> **✅ Shipped in PR #1 (`claude/modest-albattani-620j27`):** SEC-15, SEC-4, partial SEC-6, credential-expiry enforcement, CI + `.env.example` + hygiene.

## Scoring legend
**RICE = (Reach × Impact × Confidence) ÷ Effort.**
- **Reach** — relative 1–10 (share of tenants/agents affected per quarter; pre-product, treat "every tenant" items as high).
- **Impact** — 3 massive · 2 high · 1 medium · 0.5 low.
- **Confidence** — 1.0 high · 0.8 medium · 0.5–0.6 low/speculative.
- **Effort** — person-weeks.
- **Gate** — ✅ = ships before GA *regardless of RICE* (a leaking vault isn't a trade-off you RICE your way out of). RICE ranks effort-efficiency *among non-gated* work.

> Reach/Confidence are estimates with no live Sanction traffic data. Many security items have uniform "all tenants" reach, so RICE there is dominated by impact ÷ effort; trust the Gate column over RICE for the existential set.

## Security
| ID | Item | R | I | C | E | RICE | Gate | Code status / notes |
|----|------|---|---|---|---|------|------|---------------------|
| SEC-15 | **Authenticated management plane** (owner `sk_` key; gate `/agents`,`/vault`,`/stats`; fail-closed + bootstrap) | 10 | 3 | 1.0 | 1.5 | 20.0 | ✅ | **✅ SHIPPED PR #1.** Closed a *live* P0: unauth `POST /agents` + published wallet_id → vault disclosure. Draft had missed this. |
| SEC-4 | Atomic spend decrement + idempotency keys + policy precedence | 9 | 2 | 0.8 | 2 | 7.2 | ✅ | **✅ SHIPPED PR #1.** Was racing; now per-agent `pg_advisory_xact_lock` in a tx + `Idempotency-Key`. Precedence confirmed correct. |
| SEC-2 | GCM unique nonce + AAD(tenant‖cred‖version) binding | 10 | 3 | 0.8 | 1 | 24.0 | ✅ | **✅ SHIPPED PR #1.** Versioned ciphertext (v1) binds AAD=`walletId:label`; legacy blobs decrypt via fallback + upgrade on next write. Nonce-uniqueness + tamper + AAD-mismatch unit-tested. |
| SEC-1 | Envelope encryption: KMS root + per-tenant DEKs | 10 | 3 | 0.8 | 4 | 6.0 | ✅ | ⚠ Confirmed open: one global env-var key, no `keyId`, no rotation. Existential. |
| SEC-3 | Postgres RLS tenant isolation + forced-tenant query layer | 10 | 3 | 0.8 | 2 | 12.0 | ✅ | ⚠ Confirmed: app-code `where` filtering only, single PG role. One typo from a breach. |
| SEC-5 | JWT hardening: pin `alg`, bind `aud`/`jti`/scope, single-use, revocation | 9 | 3 | 0.8 | 2 | 10.8 | ✅ | ◑ **Mostly shipped PR #1:** `alg` now pinned `["HS256"]` (anti alg-confusion); owner-authed `POST /exec/revoke` added (inject already enforces `status`/expiry, so revocation is immediate). Remaining: `aud` binding + true single-use. |
| SEC-6 | `pxy_` key hashed at rest, scoped, rotatable, revocable | 9 | 2 | 0.9 | 1.5 | 10.8 | ✅ | ◑ Partial: keys **already SHA-256-hashed at rest**; mgmt-key bootstrap shipped (SEC-15); rotation/per-key revocation (beyond `isActive`) TODO. |
| SEC-13 | Next/Vercel hardening: `no-store` on secret responses, middleware-bypass review, bundle hygiene | 9 | 2 | 0.8 | 1 | 14.4 | | **✅ SHIPPED PR #1.** `Cache-Control: no-store` on every secret response (`/inject`, `/exec`, `/wallets`, `/wallets/bootstrap-key`). OpenAPI synced (new `code`/`remediation` + `/exec/revoke`). Remaining (future): formal middleware-bypass review. |
| SEC-12 | Rate limiting + Neon connection-exhaustion protection | 8 | 2 | 0.8 | 1 | 12.8 | | Serverless PG has a hard connection ceiling. |
| SEC-14 | Mass-assignment lockdown + SSRF allow-lists + dependency SCA | 8 | 1.5 | 0.8 | 1 | 9.6 | | Clearance-escalation + supply-chain. (CI `npm audit` shipped PR #1.) |
| SEC-7 | Tamper-evident hash-chained audit log + export | 6 | 2 | 0.7 | 3 | 2.8 | | **Sellable.** Confirmed mutable rows today; governance pitch needs cryptographic evidence. |
| SEC-8 | Purpose/egress-bound injection + anomaly detection | 6 | 3 | 0.6 | 4 | 2.7 | | **Moat + sellable.** Only defense vs. prompt-injected exfil (SIG-8). |
| SEC-10 | Migrate exec signing to asymmetric (EdDSA) | 8 | 1.5 | 0.8 | 2 | 4.8 | | Verifiers can never mint. Needs verify-both transition (also fixes JWT `iss` "autoflux"→"sanction"). |
| SEC-9 | BYOK / customer-managed KMS | 3 | 2 | 0.6 | 5 | 0.7 | | Enterprise-sales unlock (low reach, high deal-size). |
| SEC-11 | SOC2 / ISO27001 readiness | 3 | 2 | 0.7 | 8 | 0.5 | | Procurement gate; long lead, start early. |
| SEC-16 | **Rotate the AIIA agent key** (prefix was committed) + test suite (no live deps) | 8 | 1 | 1.0 | 1 | 8.0 | | ◑ Test suite **shipped PR #1** (vitest: crypto/AAD/legacy/keys/JWT, 11 tests, wired into CI). Remaining: rotate the AIIA key (owner action). |

## UX / product
| ID | Item | R | I | C | E | RICE | Gate | Notes |
|----|------|---|---|---|---|------|------|-------|
| UX-1 | Typed, remediable DENY responses (reason + remediation hint) | 9 | 2 | 0.8 | 1 | 14.4 | | **✅ SHIPPED PR #1.** `/authorize` now returns stable `code` (`BUDGET_EXCEEDED`-class) + `remediation`, additive to `reason`/`status` (AIIA-safe). Codes derived purely from persisted decision → stable on replay; unit-tested. |
| UX-2 | First-class ESCALATE/`pending` state + mandatory timeout fallback | 8 | 3 | 0.7 | 3 | 5.6 | | #1 reliability risk: escalation deadlock. Confirmed: no resolution path exists today. |
| UX-3 | Policy templates + plain-English clearance ladder (safest default) | 7 | 2 | 0.8 | 2 | 5.6 | | ◑ Policy templates (conservative/balanced/growth/enterprise) + owner-authed `GET/PUT /policy` (apply template ± overrides) shipped, unit-tested. Remaining: plain-English clearance ladder. |
| UX-6 | First-run live dry-run authorize (activation aha) | 7 | 2 | 0.7 | 2 | 4.9 | | ◑ Backend shipped: `dry_run` on `/authorize` returns a simulated decision (FUND-1/ADR-0005). Remaining: surface it in the first-run dashboard UX. |
| UX-4 | One-glance mobile approvals (Approve/Deny/"Always allow under $X") | 6 | 2 | 0.7 | 3 | 2.8 | | Graduates an escalation into a rule. |
| UX-5 | `/wallets/stats` dashboard (spend vs cap, burn, escalations, denials, audit feed) | 7 | 1.5 | 0.8 | 3 | 2.8 | | Dashboard exists but env-var bug fixed in PR #1; expand into the trust artifact. |

## Distribution / GTM
| ID | Item | R | I | C | E | RICE | Gate | Notes |
|----|------|---|---|---|---|------|------|-------|
| DIST-1 | MCP Registry `server.json` + elite tool names/descriptions | 9 | 3 | 0.9 | 0.5 | 48.6 | | **✅ SHIPPED.** `server.json` manifest (npm `sanction-mcp`, stdio, env vars) + tool annotations (`readOnlyHint` on wallet-status; titles + `openWorldHint`) and sharper "call BEFORE / bypassing fails" descriptions (SIG-7). Publish step: run `mcp-publisher` to push to the official registry. |
| DIST-4 | Anthropic Connectors Directory submission | 7 | 2 | 0.7 | 1 | 9.8 | | Curated, trafficked; security posture clears the bar (SIG-4). |
| DIST-2 | A2A AgentCard at `/.well-known/agent-card.json` | 4 | 1 | 0.8 | 0.5 | 6.4 | | **✅ SHIPPED PR #1.** Static card (3 skills) pointing at the live OpenAPI spec. |
| DIST-3 | AIIA dogfood → reference arch + OSS quickstart template | 7 | 3 | 0.7 | 4 | 3.7 | | Proof + case study + copy-paste adoption. AIIA's AUTO/SUPERVISED/GATED maps ~1:1 to clearance. |
| DIST-5 | Bedrock Action Group hardening + AgentCore Agent Registry listing | 6 | 2 | 0.6 | 2 | 3.6 | | Early-mover on a new enterprise surface (SIG-5). |
| DIST-6 | "Production agent security" content/SEO (clearance narrative) | 6 | 1.5 | 0.6 | 3 | 1.8 | | Proven intent pool (agent OAuth, scoped tokens, spend limits). |

## Payments / positioning
| ID | Item | R | I | C | E | RICE | Gate | Notes |
|----|------|---|---|---|---|------|------|-------|
| FUND-1 | Resolve funding/custody model + ship simulation mode | 10 | 3 | 0.6 | 4 | 4.5 | ✅* | **✅ RESOLVED + simulation shipped.** Founder decision: **control plane, no custody** (ADR-0005). `POST /authorize {dry_run:true}` previews a decision without persisting/spending. GA no longer custody-blocked. |
| POS-1 | AP2 Intent-Mandate issuer + x402 facilitator | 6 | 2.5 | 0.5 | 5 | 1.5 | | The category position AP2 left open (SIG-1/2). Depends on FUND-1. |

## Top of the list by RICE (non-gated, do-these-for-leverage)
1. **DIST-1** (48.6) — MCP manifest + tool descriptions.
2. **SEC-2** (24.0) — GCM nonce/AAD (also a gate; nonce half-done).
3. **SEC-13** (14.4) — Next/Vercel hardening.
4. **UX-1** (14.4) — typed DENY.
5. **SEC-12** (12.8) — rate limiting.

…executed **after/alongside** the remaining gated security set (`SEC-1,2(AAD),3,5,6`) and the `FUND-1` decision. **Already cleared from the gate: SEC-15, SEC-4.**
