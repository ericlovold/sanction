# Sanction — Product Ownership (consolidated)

> The single document that ties discovery, product, market, security, and the iteration engine together. Read this first; follow the links for depth. Owner view, as of 2026-06-15.

## Map of the docs
| Doc | Purpose |
|---|---|
| [DISCOVERY.md](DISCOVERY.md) | What's actually built (real / stubbed / aspirational), with code evidence |
| [PRODUCT.md](PRODUCT.md) | Value prop, ICP, JTBD, DX walkthrough, README-vs-reality |
| [MARKET.md](MARKET.md) | Cited competitive landscape across 4 adjacent markets |
| [POSITIONING.md](POSITIONING.md) | Category, one-liner, the wedge |
| [SECURITY-THREAT-MODEL.md](SECURITY-THREAT-MODEL.md) | Full threat model, F1–F10 |
| [SECURITY-FINDINGS.md](SECURITY-FINDINGS.md) | Day-one checks V1–V3 answered with code evidence |
| [../ROADMAP.md](../ROADMAP.md) · [../BACKLOG.md](../BACKLOG.md) · [SIGNALS.md](SIGNALS.md) · [DECISIONS.md](DECISIONS.md) | The continual-iteration engine |

## 1. What Sanction actually is (verified)
A **pre-action authorization + credential layer for autonomous agents**: a policy-driven spend authorizer, an AES-256-GCM credential vault released only against short-lived scoped execution JWTs, and an audit log — distributed over REST, **MCP**, and AWS Bedrock. As built it **authorizes and records**; it does **not** custody or move funds (the `stripe` dep is unused). The schema is strong; enforcement and access control lag it.

## 2. The thesis, tested against the repo and the market
**Holds.** The "can it act unsupervised?" gap is real and acknowledged by the largest vendors (Okta: 91% use agents, ~10% govern them; AI-secret leaks +81% in 2025). The "three pillars = one mechanism" framing is sound: `agent identity → clearance → scoped JWT → enforced at spend + credentials → audited`.

**Where the founder's initial framing needs adjustment (verify-don't-assume):**
- **"Clearance levels are the wedge/brand"** — *great narrative, but currently vaporware in code*: clearance is stored and stamped into JWTs but **never enforced** and **cannot be assigned via API** (DISCOVERY §6). Lead with it in the *story*, but it must be wired (BACKLOG N-4) before it's a real differentiator. Until then, the honest wedge is **spend authorization + scoped credential injection**.
- **"It moves money"** — it doesn't yet. That's actually a **compliance asset** (stays out of money-transmitter/PCI scope). Make it a deliberate decision, not an accident (DECISIONS ADR-0005).
- **Pricing signals "side project"** — agreed; monetize Enterprise trust (SSO, audit export, BYOK, SLA) on a value metric you govern (spend secured), not agent count.

## 3. Architecture & scale review
- **Critical-path risk is real:** `/authorize` gates every agent action, so Sanction's p99 latency/uptime cap the agent's ability to act. Define SLOs; cache the common auto-approve-under-threshold decision; reserve round-trips for escalations.
- **Correctness at concurrency is broken today:** budget checks are read-then-write with no transaction → **double-spend over cap** (FINDINGS V2a). Must be atomic before any scale claim.
- **Multi-tenancy is app-code-only** (no Postgres RLS) and **four endpoints are unauthenticated** → cross-tenant reads are possible *today* (FINDINGS V2b, THREAT F1–F4).
- **Key management won't survive multi-tenant trust:** one global AES key, no envelope encryption, no rotation (FINDINGS V1).

## 4. Security & trust = the product
Existential issues, in fix order:
1. **P0 — Lock the management plane** (`/agents`, `/vault`, `/stats`, `/wallets`). A *published* wallet id + unauthenticated `POST /agents` is a live credential-disclosure chain (THREAT F1/F2). **S-1, S-2.**
2. **P1 — Atomic budgets + idempotency** (FINDINGS V2a). **S-8.**
3. **P1 — Hygiene**: scrub live ids, rotate AIIA key, finish rename, fix dashboard env, add CI (FINDINGS, DISCOVERY §7). **S-4, S-5, S-7.**
4. **P1 — Harden key & audit**: envelope/KMS + per-cred keyId (V1); tamper-evident/exportable audit (V3). **L-1, L-2.**
5. **P1 — Tenant isolation defense-in-depth**: Postgres RLS (V2b). **S-9.**

## 5. UX / DX
Concepts are clean; ~5 API calls to a governed agent; MCP is one config block. Friction: **no SDK**, **no policy/clearance management API**, **no escalation resolution**, **management endpoints unauthenticated**, naming drift ("AutoFlux"/`pxy_`). Fixing these is what turns the demo into a product (PRODUCT §5).

## 6. GTM & monetization
- **Motion:** developer-first PLG via MCP/A2A ecosystem (dogfood **AIIA** as design partner #1), expanding to security/platform buyers once SOC 2 lands.
- **Pricing:** free + cheap dev tiers for adoption; **Enterprise = trust & compliance** (SSO, audit export, BYOK/on-prem, SLA). Value metric: spend governed / risk avoided.
- **First design-partner profiles:** AIIA; A2A/MCP agent startups; internal-automation teams already burning LLM spend; vertical agents (finance/devops) that need credential scoping + audit.
- **Distribution edge:** rail-neutral consent/audit brain above ACP/AP2/x402 — defensible regardless of which payment standard wins (POSITIONING §5).

## 7. Risks & open questions
- **Absorption** by Okta/Microsoft/Google/Stripe (mitigate: developer-first, rail-neutral).
- **Standards unsettled** (ACP vs AP2 vs x402) — stay the abstraction layer.
- **Agent-spend adoption may lag hype** — lead with credentials+governance (needed today), treat payments as upside.
- **Trust bar is absolute** — one breach is fatal; SOC 2 + clean key mgmt are prerequisites to revenue.
- **Open forks for the founder:** (a) ADR-0005 control-plane vs. fund custody; (b) pricing/value metric; (c) how hard to lean on "clearance" branding before it's enforced.

## 8. Recommended first three moves (recommendation, not options)
1. **Close the P0/P1 security gaps** — auth on the management plane (S-1/S-2), atomic budgets (S-8), hygiene + CI (S-4/S-5/S-7). *Non-negotiable; the product's only asset is trust, and it's currently exploitable on the live deployment.*
2. **Make the narrative true** — wire policy management + escalation (N-1/N-2) and either enforce clearance or stop leading with it (N-4); trim README over-claims. *Closes the gap between the pitch and the build.*
3. **Reduce integration friction + dogfood** — ship a TS/Python SDK (N-5) and route **AIIA** through Sanction end-to-end. *Turns "convincing demo" into "adopted product" and creates the fastest API-design feedback loop.*

> Everything here is traceable to code (DISCOVERY/FINDINGS) or cited sources (MARKET); unverified market claims are flagged in MARKET.md. Re-run this synthesis each cycle as SIGNALS.md updates.
