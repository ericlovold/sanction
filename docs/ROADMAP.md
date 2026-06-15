# Sanction — Roadmap

> Canonical roadmap. Adopted from the agent-team draft and **validated against the code** (2026-06-15). IDs cross-reference `BACKLOG.md`. Direction changes logged in `DECISIONS.md`.
>
> **Discovery answered the draft's open questions:** `/authorize` **did** race (fixed, SEC-4); the master key is a **single env var** (SEC-1 open); there is **no funding integration** today — `stripe` is unused and budgets are accounting caps over the dev's own rails (FUND-1 current-state resolved).

## The thesis this roadmap serves
Sanction's defensible product is **the cross-platform governance + human-escalation plane on top of AP2/MCP that no single platform owns**, made trustworthy by provable security and sold **clearance-first**. The vault is table stakes; the *policy + escalation + proof* is the product. Three independent discovery lenses (security, UX, distribution) converged here — that's where conviction is highest. Code discovery adds a fourth confirmation: the *injection core is well-built*, so the defensible work is enforcement, isolation, and escalation — not rebuilding the primitive.

## The gate before everything
A credential vault that can leak every tenant's secrets is uninvestable. These **ship before GA regardless of RICE**:
- ✅ **`SEC-15` authenticated management plane** — *shipped PR #1* (closed a live unauth credential-disclosure P0).
- ✅ **`SEC-4` atomic spend + idempotency** — *shipped PR #1*.
- ⬜ **`SEC-1`** envelope encryption (KMS + per-tenant DEKs) — *open; single env-var key today*.
- ◑ **`SEC-2`** GCM nonce uniqueness (✅ random-96-bit confirmed) **+ AAD binding** (⬜ TODO).
- ⬜ **`SEC-3`** Postgres RLS tenant isolation (app-code filtering only today).
- ⬜ **`SEC-5`** JWT binding/revocation (HS256 single secret; no revocation setter).
- ◑ **`SEC-6`** `pxy_` key hashing (✅ already hashed) / scoping / rotation / revocation (⬜).
- ⬜ **`FUND-1` decision** — *where does the money sit?* Current code answer: **nowhere (no custody)**. The decision is whether to keep it that way (control-plane, minimal regulatory surface) or add real rails. Reshapes security blast radius, money-transmission surface, and AP2 positioning at once. See ADR-0005.

---

## NOW — pre-GA (~0–6 weeks): earn the right to hold credentials
- **Security gate (remaining):** `SEC-1`, `SEC-2`(AAD), `SEC-3`, `SEC-5`, `SEC-6`(rotation/revocation). *(`SEC-15`, `SEC-4` done.)*
- **`SEC-16` hygiene follow-up** — rotate the AIIA agent key (prefix was committed; PR #1 scrubbed the doc) + add the unit-test suite.
- **`FUND-1`** — ratify custody model (recommend: control-plane, no custody) + ship **simulation mode** so devs activate without funding.
- **`DIST-1`** — MCP Registry `server.json` with best-in-class tool descriptions ("call BEFORE any spend/credential action; bypassing fails"). Highest effort:leverage play in the plan.
- **`UX-1`** — typed, remediable DENY responses (`BUDGET_EXCEEDED` + remediation hint). PR #1 already returns a `reason`; formalize the code set.

## NEXT — GA → ~3 months: become the thing agents *choose* and devs trust
- **`UX-2`** — first-class ESCALATE state + mandatory per-policy timeout fallback. The #1 reliability risk is escalation deadlock; confirmed there's no resolution path today.
- **`UX-3` / `UX-4`** — policy templates + plain-English clearance ladder; one-glance mobile approvals.
- **`UX-5` / `UX-6`** — expand the `/wallets/stats` dashboard + first-run live dry-run authorize (activation aha).
- **`SEC-12` / `SEC-13` / `SEC-14`** — rate limiting + Neon protection, Next/Vercel hardening, mass-assignment/SSRF/SCA.
- **`SEC-8`** — purpose/egress-bound credential injection + anomaly detection. Defends the category-defining threat (a prompt-injected agent exfiltrating a secret) — moat *and* sellable.
- **Clearance enforcement (per founder decision: "wire it, then lead with it")** — make clearance actually gate scopes/categories + add an assignment endpoint, so the brand wedge is real, not modeled-only.
- **`DIST-3`** — AIIA dogfood → reference architecture + OSS quickstart. AIIA's AUTO/SUPERVISED/GATED execution maps ~1:1 onto clearance levels.
- **`DIST-2` / `DIST-4`** — A2A AgentCard; submit to the Anthropic Connectors Directory.

## LATER — 3–9 months: enterprise trust + ecosystem moat
- **`SEC-7`** — tamper-evident, hash-chained audit log + export. Turns governance into cryptographic evidence — the enterprise unlock.
- **`SEC-9` BYOK; `SEC-11` SOC2; `SEC-10` asymmetric exec signing (EdDSA)** so verifiers can never mint.
- **`POS-1`** — AP2 Intent-Mandate issuer + x402 facilitator (be the policy/budget/clearance layer AP2 deliberately left open).
- **`DIST-5` / `DIST-6`** — AgentCore Agent Registry + AWS Marketplace listing; own the "production agent security" content lane.

---

## The clock you're racing
AWS AgentCore Identity already vaults credentials; Stripe owns agentic payments; WorkOS/Auth0/Scalekit/Composio are racing into agent identity. Each pillar risks being absorbed by a platform default. The defensible position is **cross-platform + clearance-native + the human-escalation plane** — do not anchor on "Stripe for agents" (occupied) or get cornered into one cloud's catalog as a feature. See `SIGNALS.md`.
