# Sanction — Roadmap

> Canonical roadmap. Adopted from the agent-team draft and **validated against the code** (2026-06-15). IDs cross-reference `BACKLOG.md`. Direction changes logged in `DECISIONS.md`.
>
> **Discovery answered the draft's open questions:** `/authorize` **did** race (fixed, SEC-4); the master key is a **single env var** (SEC-1 open); there is **no funding integration** today — `stripe` is unused and budgets are accounting caps over the dev's own rails (FUND-1 current-state resolved).

## The thesis this roadmap serves
Sanction's defensible product is **the cross-platform governance + human-escalation plane on top of AP2/MCP that no single platform owns**, made trustworthy by provable security and sold **clearance-first**. The vault is table stakes; the *policy + escalation + proof* is the product. Three independent discovery lenses (security, UX, distribution) converged here — that's where conviction is highest. Code discovery adds a fourth confirmation: the *injection core is well-built*, so the defensible work is enforcement, isolation, and escalation — not rebuilding the primitive.

## Execution gating: pull before paywall (added 2026-06-23)

The NOW/NEXT/LATER below is the engineering/security plan. This is the **GTM sequencing overlay** decided 2026-06-23 — *what to build in what order, and the signal that unlocks each step.* It reframes existing items; it doesn't replace them.

**The constraint:** pre-traction, ~0 external agents. The bottleneck is **pull, not features.** Building the paid tier now is a paywall for an empty room.

**Two wedges, reconciled** (resolves the recurring "what's *the* wedge?" question):
- **Adoption wedge = the gateway** — zero-friction on-ramp (point base URL + `x-sanction-key`, metered + capped). Gets agents *in*.
- **Monetization + positioning wedge = the human-in-the-loop approval layer** ("approval that finds you" — `POSITIONING.md` §0). It *is* roadmap items **UX-2** (escalate + timeout), **UX-4** (one-glance mobile approvals), and **SEC-7** (audit export) — already planned; this names them as *the* conversion engine, not just UX.

**The signal-gated sequence:**
1. **Phase 1 — get pull (now).** Goal: **3–5 external wallets that actually run an agent.** Distribution = framework integration guides (Vercel AI SDK, LangChain, CrewAI) + MCP discoverability + a great Cursor/Claude Code setup guide (cheap, no BD). **Measure:** `external.active` via `GET /api/admin/pulse`, plus the activation funnel events (`wallet_created → test_decision → snippet_copied → first_gateway_call`). Fix the biggest drop-off. **Do not build Team features yet.**
2. **GATE →** when `external.active > 0` *and* someone hits a real escalation in the wild — that's the demand signal.
3. **Phase 2 — build the wedge.** The approval + notification layer, one reach channel first: **email** (cheapest; `lib/email.ts`/Resend already wired) → **Slack** (highest team value) → SMS/push, plus audit export. (= UX-2/UX-4/SEC-7, pulled forward by the signal.)
4. **Phase 3 — monetize.** Tier reframe: sell **agency-at-scale**, not "more agents." The buy = reliably reaching the *right* human (Slack routing, approver roles) + audit + SSO.

**Tier reframe (the "why buy"):**

| Tier | The line | Gated on |
|---|---|---|
| Free | solo dev, dogfood | 1 agent, basic caps, short retention, gateway |
| Pro $19 | serious individual | more agents, longer retention, per-agent budgets |
| **Team $49+** | **the real buy** | **approval routing (Slack/email/SMS/push), audit export, roles/SSO** |
| Enterprise | regulated / security | Sanction ID (`NEXT-TIER.md`), clearance, VPC, SLA |

The jump to **Team** is the money; the reason to jump is the approval layer. (Usage-based pricing is *available later* — the gateway already meters spend — but start tier-based: simpler pre-scale. Trade-off: tiers leave metered-value money on the table at scale; revisit post-traction.)

**Done 2026-06-23 (Phase 0 — activation + measurement):** onboarding simplification — in-browser test decision, stack-picker SDK snippets, live first-call confirmation, activation funnel events (`docs/EPIC-onboarding-simplification.md`); adoption pulse endpoint (`/api/admin/pulse`); one-click MCP CI publish (`sanction-mcp@0.1.3`).

## First prospect signal — David / MMHC (healthcare, 2026-06-24)

First real inbound: a warm, technical healthcare prospect (MMHC — an AI-first platform replacing site/CRM/ITSM/portal → eventually the EMR, with an agentic layer of topical agents) got keys and sent an architecture-gating question list. ~1 month from wanting pilot customers; **no signed client yet**, so per the gating discipline above these are **demand-validated, build deal-triggered.** The notable strategic read: **the first pull is enterprise/healthcare-grade infra (BAA, SLA, vaulting, org) — not the prosumer approval wedge.** Both wedges are now demand-signaled; the warm one is enterprise.

His 6 questions → roadmap:

| # | Question | Status today | Action |
|---|---|---|---|
| 1 | PHI persistence / BAA | **Strong** — gateway persists metadata only; no prompt/response bodies stored or logged | **NEW: HIPAA/BAA-isolated gateway on Render** — stateless proxy on HIPAA-eligible infra (Render BAA upstream; sign BA with customer downstream). Deal-triggered, Enterprise, **price as pass-through + BA liability + ops**. Sub-fix: `/authorize` `description` persists free text → make PHI-safe (optional no-store / redaction). |
| 2 | Fail-open/closed + SLA | in-path **fail-closed**, no formal SLA | **ELEVATE: gateway reliability** — document fail behavior + client fallback guidance now (clients default fail-open-with-alert + direct-to-provider); HA/redundancy + SLA at Enterprise. In-path-middleware buyers demand this ("been burned"). |
| 3 | Provider-key vaulting (pxy_-only) | **roadmap** — agent passes its own provider key | **ELEVATE `NEXT-TIER` §2** vault-injected provider keys — demand-validated. Interim seam = env-resolved provider key, server-side. |
| 4 | Control-plane API | **LIVE** — `sk_`: create/list agents, per-agent + wallet budgets, clearance | Validated. **Pull forward `SEC-6`** programmatic key rotation/revocation (per-tenant auto-provisioning needs it). |
| 5 | Multi-tenant / org | interim works (agent-per-tenant; `tenantId`→`agentId`) | Interim sufficient for pilot (he agreed). **Org/team layer (`NEXT-TIER` §4)** demand-noted for master-account scale; not urgent. |
| 6 | Gateway model routing | per-provider path; switch baseURL | Fine as-is. Optional low-pri DX: model-based routing on one base URL. |

**Ships now (no client needed):** non-PHI gateway, control-plane auto-provisioning, env-resolved key seam, `tenantId`→`agentId` mapping — all usable today.
**Deal-triggered (Enterprise/HIPAA bundle):** Render BAA gateway (#1) · reliability/SLA hardening (#2) · provider-key vaulting (#3) · key-rotation API (#4) · org layer (#5). Build when a paid pilot commits; entity (C-corp) stood up *before* any BAA/contract signature.

**Parked idea (don't lose):** *multiple gateway nodes per provider* — redundant gateway endpoints (per provider / per region) for HA + failover, feeding the SLA story in #2. Distinct from the account-tree "nodes" (those are budget/org nodes). Revisit with the reliability/SLA work.

## The gate before everything

> **Reconciled against code 2026-06-26 (full audit).** The docs had drifted *behind* the build — most of this set is now SHIPPED. The **one genuinely open gate is `SEC-3` (Postgres RLS)**; `SEC-1` needs only its KMS-root/rotation finish (per-tenant key derivation is already done). You can lead with security.

A credential vault that can leak every tenant's secrets is uninvestable. These **ship before GA regardless of RICE**:
- ✅ **`SEC-15` authenticated management plane** — *shipped PR #1* (closed a live unauth credential-disclosure P0).
- ✅ **`SEC-4` atomic spend + idempotency** — *shipped PR #1*; **advisory lock verified under concurrency 2026-06-26** (`tests/concurrency.db.test.ts`: 10×$10 vs a $50/day budget → approves ≤ $50, no leak).
- ◑ **`SEC-1`** envelope encryption — **per-wallet HKDF-derived keys SHIPPED** (V2 ciphertext, `walletId` salt → blast-radius isolation done; `lib/jwt.ts`). *Remaining:* move the master key from an env var to a KMS + a rotation runbook.
- ✅ **`SEC-2`** GCM unique nonce (random 96-bit) **+ AAD binding** — `AAD=walletId:label` enforced; legacy V0/V1 fallback + upgrade-on-write (`lib/jwt.ts`, tested).
- ⬜ **`SEC-3`** Postgres RLS tenant isolation — **the one open gate.** App-code `walletId` filtering is complete and correct on every route, but `lib/tenantDb.ts` is **unused** and there are no `CREATE POLICY` migrations. A single missed `where` = cross-tenant leak. **Table stakes for the MMHC healthcare pull.**
- ✅ **`SEC-5`** JWT hardening — `alg` pinned to HS256; **`aud`=wallet bound and enforced on `/inject`**; `jti` = `ExecutionToken` id; revocation (`POST /api/v1/exec/revoke`). (`lib/jwt.ts`, tested.)
- ◑ **`SEC-6`** `pxy_`/`sk_` key hashing (✅) + rotation/revocation (✅ `POST /api/v1/agents/rotate`, `PATCH /api/v1/agents {active:false}`) — finer-grained scoping (⬜).
- ✅ **`FUND-1`** — **control-plane / no custody** (current code; `stripe` unused). Simulation mode (`?simulate=true` on `/authorize`) shipped so devs activate without funding. Formalize in ADR-0005.

---

## NOW — pre-GA (~0–6 weeks): earn the right to hold credentials
- **Security gate (remaining): only two items left.** `SEC-3` Postgres RLS + make `lib/tenantDb.ts` the mandatory query path; and `SEC-1`'s finish (KMS-root master key + rotation runbook — per-tenant derivation already shipped). *Everything else in the gate — `SEC-2/4/5/6/15` — is shipped, and `SEC-4`'s lock is concurrency-verified.*
- ✅ **`FUND-1`, `DIST-1`, `UX-1`, simulation mode, clearance enforcement** — **all shipped** (control-plane confirmed; MCP `server.json` published; typed `code`+`remediation` on `/authorize`; `/inject` enforces `minClearance` fail-closed). Carried here only as a record.
- **Gateway ↔ `/authorize` budget:** the gateway meters the **token** budget but not the **spend** budget — they're independent today. Decide: unify or document explicitly (one-liner either way).

## NEXT — GA → ~3 months: become the thing agents *choose* and devs trust
- ◑ **`UX-2`** — the **in-app** ESCALATE loop is shipped (`/api/v1/approvals` approve/reject, policy-driven **timeout settlement**, `escalation.created/resolved` webhooks, `/dashboard/approvals`). *Remaining = the Phase-2 wedge:* notification **routing** ("approval that finds you" — email→Slack→SMS/push).
- ◑ **`UX-3` / `UX-4`** — policy editor (`/wallets/policy` + `/dashboard/spend`) shipped; remaining = packaged templates / plain-English clearance ladder + one-glance **mobile** approvals.
- ✅ **`SEC-12` / `SEC-13`** — IP rate limiting (`lib/rateLimit.ts`, wallet-create throttle) + `no-store` on secret responses shipped. `SEC-14` (SSRF/SCA) ongoing — webhook URL validation is in (`lib/webhooks.ts`, public-HTTPS-only).
- ✅ **Clearance enforcement** — done (`/inject` fail-closed `minClearance`, `PATCH /agents` sets level). The brand wedge is real, not modeled-only.
- **`SEC-8`** — purpose/egress-bound credential injection + anomaly detection. Defends the category-defining threat (a prompt-injected agent exfiltrating a secret) — moat *and* sellable.
- ✅ **`DIST-2`** A2A AgentCard shipped (`/.well-known/agent-card.json`). **`DIST-3`** AIIA dogfood + **`DIST-4`** Anthropic Connectors Directory submission still open.

## LATER — 3–9 months: enterprise trust + ecosystem moat
- **`SEC-7`** — tamper-evident, hash-chained audit log + export. Turns governance into cryptographic evidence — the enterprise unlock.
- **`SEC-9` BYOK; `SEC-11` SOC2; `SEC-10` asymmetric exec signing (EdDSA)** so verifiers can never mint.
- **`POS-1`** — AP2 Intent-Mandate issuer + x402 facilitator (be the policy/budget/clearance layer AP2 deliberately left open).
- **`DIST-5` / `DIST-6`** — AgentCore Agent Registry + AWS Marketplace listing; own the "production agent security" content lane.

---

## The clock you're racing
AWS AgentCore Identity already vaults credentials; Stripe owns agentic payments; WorkOS/Auth0/Scalekit/Composio are racing into agent identity. Each pillar risks being absorbed by a platform default. The defensible position is **cross-platform + clearance-native + the human-escalation plane** — do not anchor on "Stripe for agents" (occupied) or get cornered into one cloud's catalog as a feature. See `SIGNALS.md`.
