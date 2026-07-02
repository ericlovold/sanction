# Sanction — Roadmap

> Canonical roadmap. Adopted from the agent-team draft and **validated against the code** (2026-06-15). IDs cross-reference `BACKLOG.md`. Direction changes logged in `DECISIONS.md`.
>
> **Discovery answered the draft's open questions:** `/authorize` **did** race (fixed, SEC-4); the master key is a **single env var** (SEC-1 open); there is **no funding integration** today — `stripe` is unused and budgets are accounting caps over the dev's own rails (FUND-1 current-state resolved).

## The thesis this roadmap serves
Sanction's defensible product is **the cross-platform governance + human-escalation plane on top of agent builders, AP2, and MCP that no single platform owns**, made trustworthy by provable security and sold **clearance-first**. The vault is table stakes; the *policy + escalation + proof* is the product. Three independent discovery lenses (security, UX, distribution) converged here — that's where conviction is highest. Code discovery adds a fourth confirmation: the *injection core is well-built*, so the defensible work is enforcement, isolation, and escalation — not rebuilding the primitive.

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

## Agent-platform wave — Omnigent-style launches (2026-07-01)

Agent-builder platforms are becoming the new distribution surface: OpenAI Agent Kit, GitHub Agent HQ, OutSystems Agent Workbench, Pega Agentic Process Fabric, cloud runtimes, and Omnigent-style launches all make it easier for teams to create more agents faster. This is **validation**, not the fight. Sanction should not become an agent builder. The winning posture is:

> Launch agents anywhere. Govern them in Sanction.

**Strategic read:** agent platforms create action; Sanction authorizes action. Native platform governance will commoditize generic "approval dashboards," so Sanction must own what a single builder cannot credibly own: cross-platform spend caps, credential vaulting, one-use grants, cascade pools, audit evidence, ethical review packages, and an external authorization boundary that works across runtimes.

**Roadmap response:**

| Item | Build | Why |
|---|---|---|
| `DIST-7` | **Agent-platform starter kit** — one recipe every builder can copy: before spend/tool/credential/provision, call Sanction; if escalated, wait for grant; if denied, stop. Ship as REST + MCP + webhook examples. | Turns every new agent platform into a distribution channel instead of a competitor. |
| `DIST-8` | **Runtime integration guides** — docs and MCP examples for Omnigent-style platforms, OpenAI Agent Kit, GitHub Agent HQ, Bedrock AgentCore, OutSystems, Pega, and custom runtimes. Do not turn these into new product surfaces. | Sales clarity without brand sprawl: Sanction is the independent control plane beside whatever builder the buyer chose. |
| `DX-2` | **Source/runtime attribution** — tag agents and authorization requests by runtime/source (`cursor`, `claude-code`, `codex`, `omnigent`, `bedrock`, `custom`) for dashboards, audit export, and activation analytics. | Makes cross-platform governance visible and proves neutrality in the product. |
| `POS-2` | **Independent authorization boundary copy** — codify the line: "Agent platforms create action. Sanction authorizes action." | Keeps the category crisp as builders add native governance. |

**Do not overbuild here:** no workflow builder, no competing orchestration layer, no proprietary agent spec. Integrate with builders through REST, MCP, webhooks, and gateway middleware. The moat is the external, rail-neutral decision point.

## Ethical AI / Moral Intention Analyst boundary (2026-07-01)

Fable recommendation accepted: for now, the public surface area is **Sanction Local** and **Sanction MCP**. No more explicit product surfaces.

Sanction Local is the paid, airgapped/private product packaging. Sanction MCP is the open distribution vehicle and agent-runtime integration surface. Ethics/MIA work remains useful as strategy, private service packaging, and future Local modules, but not as public pages.

**Roadmap rule:** do not publish `/ethical-ai` or `/mia-local`, do not link Ethical AI or Moral Intention Analyst from public navigation, and do not create another named product page without explicit founder approval. Keep the internal plan in `docs/MIA-LOCAL.md` until the commercial story is ready, and fold any revived packaging into Sanction Local or private services by default.

## The gate before everything
A credential vault that can leak every tenant's secrets is uninvestable. These **ship before GA regardless of RICE**:
- ✅ **`SEC-15` authenticated management plane** — *shipped PR #1* (closed a live unauth credential-disclosure P0).
- ✅ **`SEC-4` atomic spend + idempotency** — *shipped PR #1*.
- ⬜ **`SEC-1`** envelope encryption (KMS + per-tenant DEKs) — *open; single env-var key today*.
- ◑ **`SEC-2`** GCM nonce uniqueness (✅ random-96-bit confirmed) **+ AAD binding** (⬜ TODO).
- ⬜ **`SEC-3`** Postgres RLS tenant isolation (app-code filtering only today).
- ⬜ **`SEC-5`** JWT binding/revocation (HS256 single secret; no revocation setter).
- ◑ **`SEC-6`** `pxy_` key hashing (✅) / rotation + revocation (✅ `POST /api/v1/agents/rotate`, `PATCH /api/v1/agents {active:false}` — 2026-06-24) / scoping (⬜).
- ⬜ **`FUND-1` decision** — *where does the money sit?* Current code answer: **nowhere (no custody)**. The decision is whether to keep it that way (control-plane, minimal regulatory surface) or add real rails. Reshapes security blast radius, money-transmission surface, and AP2 positioning at once. See ADR-0005.

---

## NOW — pre-GA (~0–6 weeks): earn the right to hold credentials
- **Security gate (remaining):** `SEC-1`, `SEC-2`(AAD), `SEC-3`, `SEC-5`, `SEC-6`(rotation/revocation). *(`SEC-15`, `SEC-4` done.)*
- **`SEC-16` hygiene follow-up** — rotate the AIIA agent key (prefix was committed; PR #1 scrubbed the doc) + add the unit-test suite.
- **`FUND-1`** — ratify custody model (recommend: control-plane, no custody) + ship **simulation mode** so devs activate without funding.
- **`DIST-1`** — MCP Registry `server.json` with best-in-class tool descriptions ("call BEFORE any spend/credential action; bypassing fails"). Highest effort:leverage play in the plan.
- **`DIST-7`** — agent-platform starter kit: universal pre-action authorization recipe for Omnigent-style builders, OpenAI Agent Kit, GitHub Agent HQ, AgentCore, and custom runtimes.
- **`UX-1`** — typed, remediable DENY responses (`BUDGET_EXCEEDED` + remediation hint). PR #1 already returns a `reason`; formalize the code set.

## NEXT — GA → ~3 months: become the thing agents *choose* and devs trust
- **`UX-2`** — first-class ESCALATE state + mandatory per-policy timeout fallback. The #1 reliability risk is escalation deadlock; confirmed there's no resolution path today.
- **`UX-3` / `UX-4`** — policy templates + plain-English clearance ladder; one-glance mobile approvals.
- **`UX-5` / `UX-6`** — expand the `/wallets/stats` dashboard + first-run live dry-run authorize (activation aha).
- **`SEC-12` / `SEC-13` / `SEC-14`** — rate limiting + Neon protection, Next/Vercel hardening, mass-assignment/SSRF/SCA.
- **`SEC-8`** — purpose/egress-bound credential injection + anomaly detection. Defends the category-defining threat (a prompt-injected agent exfiltrating a secret) — moat *and* sellable.
- **Clearance enforcement (per founder decision: "wire it, then lead with it")** — make clearance actually gate scopes/categories + add an assignment endpoint, so the brand wedge is real, not modeled-only.
- **`DIST-3`** — AIIA dogfood → reference architecture + OSS quickstart. AIIA's AUTO/SUPERVISED/GATED execution maps ~1:1 onto clearance levels.
- **`DIST-8` / `POS-2`** — runtime integration guides + independent authorization boundary positioning. Keep this inside docs/MCP distribution, not new product surfaces.
- **`DIST-2` / `DIST-4`** — A2A AgentCard; submit to the Anthropic Connectors Directory.

## LATER — 3–9 months: enterprise trust + ecosystem moat
- **`SEC-7`** — tamper-evident, hash-chained audit log + export. Turns governance into cryptographic evidence — the enterprise unlock.
- **`SEC-9` BYOK; `SEC-11` SOC2; `SEC-10` asymmetric exec signing (EdDSA)** so verifiers can never mint.
- **`POS-1`** — AP2 Intent-Mandate issuer + x402 facilitator (be the policy/budget/clearance layer AP2 deliberately left open).
- **`DIST-5` / `DIST-6`** — AgentCore Agent Registry + AWS Marketplace listing; own the "production agent security" content lane.

---

## The clock you're racing
AWS AgentCore Identity already vaults credentials; Stripe owns agentic payments; WorkOS/Auth0/Scalekit/Composio are racing into agent identity. Each pillar risks being absorbed by a platform default. The defensible position is **cross-platform + clearance-native + the human-escalation plane** — do not anchor on "Stripe for agents" (occupied) or get cornered into one cloud's catalog as a feature. See `SIGNALS.md`.
