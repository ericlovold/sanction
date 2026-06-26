# Sanction — Product Line & Services

> Working definitions for two new offerings, **Sanction Scan** and **Sanction Assess**,
> and how they fit with the core product. Draft for refinement — assumptions are
> flagged as **[ASSUMPTION]** and decisions to make are in **Open questions**.

## The shape: a land-and-expand funnel

```
  Sanction Scan          Sanction Assess           Sanction (core SaaS)
  ─────────────          ───────────────           ────────────────────
  Discover               Advise + configure        Govern (ongoing)
  low / no cost          per-client fee            Free / $19 / $49 / Ent
  "what spends?"         "what should the          "enforce it on every
                          policy be?"               spend, forever"
        │                       │                          │
        └───────► feeds ────────┴────────► converts ───────┘
```

Each stage is a natural on-ramp to the next: a Scan surfaces ungoverned spend → an
Assess turns that into a policy + config → core Sanction enforces it. Scan is also
the top-of-funnel lead magnet; Assess is the high-touch enterprise on-ramp.

**Positioning vs. Okta:** Okta for AI Agents discovers *shadow agents* on the
**identity** axis ("who is this agent, what can it connect to"). Sanction Scan
discovers them on the **money** axis ("which agents and actors can *spend*, how
much, under what policy — or none"). Different primitive, no incumbent in it.

---

## Sanction Scan

**One-liner:** Software-run audit that discovers every agent and actor in an
organization that can spend money or consume paid AI, and reports where that spend
is ungoverned.

### What it finds
- AI agents and automated **actors with spend** — anything holding a payment method,
  a paid-API key, or a token budget (not just "agents" narrowly).
- For each: estimated spend, what it can access, and whether any policy / budget /
  escalation governs it.
- **Gaps**: shadow agents, unbudgeted API keys, no per-transaction cap, no
  human-in-the-loop, no audit trail.

### Output
An inventory + risk report: *"You have N spending actors, ~$X/mo, M of them with no
controls."* The report is the conversion moment — it quantifies the exposure Sanction
closes.

### How it works — **DECIDED: provider billing/usage APIs first**
**Wedge: AI provider usage/billing APIs** (Anthropic / OpenAI usage exports, per-key
spend). Least access friction, directly quantifies spend, fastest to build. Later
sources expand coverage:
- **Cloud cost** — AWS/GCP billing tagged to service accounts.
- **Secret scanning** — paid-API keys committed in repos / CI (GitHub-style).
- **MCP / agent registries** — enumerate registered agents and their tools.
- **Sanction's own token-logging data** — for actors already reporting in.

### Why this beats identity-axis discovery (the shadow-AI point)
**Shadow-AI discovery is inherent to the spend axis.** Reading provider billing
surfaces *every actor that spends* — known or shadow — because anything consuming paid
AI shows up in the bill whether or not someone registered it. You don't have to hunt
for shadow agents the way an identity tool does; they self-report through their spend.
So Okta's headline "discover shadow agents" capability is a **byproduct** of a Sanction
Scan, not a separate feature to build — and Scan additionally tells you the one thing
identity discovery can't: *how much each one spends.*

### Form factor — **[ASSUMPTION]**
A CLI or hosted scanner the user points at their accounts → generates the report.
Likely **free basic scan** (lead gen) with a **paid deep audit** tier.

---

## Sanction Assess

**One-liner:** Paid advisory engagement that turns a client's AI spend and needs into
a token-tier system, model selections, and a deployable Sanction configuration.

### Deliverables
1. **Spend & need analysis** — where AI cost goes today, by team / agent / use case.
2. **Token-tier system** — named allowance tiers mapped to budgets and model access
   (see note below — this may deserve to become a core product primitive).
3. **Model options** — which models for which jobs, at what cost/quality trade-off.
4. **Sanction config** — concrete policies: per-txn caps, daily/monthly budgets,
   escalation thresholds, clearance levels, category allow-lists — ready to deploy.

### Engagement flow
`Scan (discover) → Assess (analyze + design) → deploy core Sanction (enforce) → handoff`

### Revenue
**Per-client fee** — services margin, distinct from the SaaS subscription. Feeds a
client into the Free/$19/$49/Enterprise ladder afterward.

> **DECIDED — the token-tier system is a first-class Sanction policy primitive,**
> not just an Assess deliverable. Named tiers (allowance level → budget + permitted
> models + clearance) become a real construct an agent is assigned to. Every Assess
> output is then a config the client can self-serve and adjust later, and it
> strengthens the core product. Design sketch below.

### Token-tier primitive — design sketch
A **Tier** is a named bundle that supplies an agent's spend *and* token limits and its
model access in one assignment, instead of hand-setting every knob per agent.

```
Tier {
  name                  e.g. "Restricted" | "Standard" | "Trusted" | "Privileged"
  monthlyTokenBudget    LLM token ceiling (ties into POST /tokens logging)
  dailySpendBudgetUsd   \
  perTransactionMaxUsd   |  same knobs as Policy today, bundled per tier
  escalateOverUsd        |  (keep escalateOverUsd < perTransactionMaxUsd — GTM-1)
  autoApproveUnderUsd   /
  allowedModels[]       which models this tier may call (gates model access)
  minClearance          1–5, reuses the existing clearance system
  allowedCategories[]   spend categories permitted
}
```

**Resolution order (extends today's logic):**
`per-agent override  →  agent's Tier  →  wallet Policy default`
So tiers slot in *between* explicit agent overrides and the wallet policy — agents get
sane bundled defaults by tier, overrides still win, nothing about the current engine
breaks. `Agent` gains an optional `tierId`.

> Implementation is a schema add (`Tier` table + `Agent.tierId`) plus extending the
> effective-limit resolution in `authorize/route.ts`. **Not yet built** — confirm the
> tier set/shape before a migration.

---

## Decisions & open questions

**Decided**
- ✅ **Scan reads AI provider billing/usage APIs first** (fastest credible wedge).
- ✅ **Shadow-AI discovery is a byproduct of the spend-axis scan** — not a separate build.
- ✅ **Token-tier system is a first-class Sanction policy primitive** (see design sketch).

**Still open — Scan**
1. Delivery: CLI, hosted dashboard, or a one-off generated report?
2. Pricing: free lead-gen, paid audit, or free basic + paid deep?

**Still open — Assess**
3. Productized fixed-scope SKU (e.g. a flat "Assessment") vs. bespoke consulting?
4. Who delivers — you, or eventually a partner/SE motion?

**Still open — Token-tier primitive**
5. The tier set/shape (names + default knobs per tier) before writing a migration.
