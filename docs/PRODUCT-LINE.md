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

### How it could work — **[ASSUMPTION], needs your call**
Candidate data sources (read-only credentials the user grants):
- **AI provider usage/billing APIs** — Anthropic / OpenAI usage exports, per-key spend.
- **Cloud cost** — AWS/GCP billing tagged to service accounts.
- **Secret scanning** — paid-API keys committed in repos / CI (GitHub-style).
- **MCP / agent registries** — enumerate registered agents and their tools.
- **Sanction's own token-logging data** — for actors already reporting in.

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

> **Note — "token-tier system" may be a product feature, not just a deliverable.**
> If tiers (named allowance levels mapping budget + permitted models) become a
> first-class Sanction policy construct, every Assess output is a config a client can
> self-serve later — and it strengthens the core product. Worth deciding deliberately.

---

## Open questions (decisions for Eric)

**Scan**
1. What does it actually read first — provider billing APIs, cloud cost, secret
   scanning, or Sanction's own log data? (Pick the cheapest-to-build wedge.)
2. Delivery: CLI, hosted dashboard, or a one-off generated report?
3. Pricing: free lead-gen, paid audit, or free basic + paid deep?

**Assess**
4. Productized fixed-scope SKU (e.g. a flat "Assessment") vs. bespoke consulting?
5. Who delivers — you, or eventually a partner/SE motion?

**Cross-cutting**
6. Does **token-tier system** become a real Sanction policy primitive, or stay an
   Assess artifact?
