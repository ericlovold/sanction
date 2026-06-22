# Sanction — Product (Phase 2)

> Value prop, ICP, jobs-to-be-done, core journeys, and a verified DX walkthrough with friction flagged. Claims here are reconciled against the code (see `DISCOVERY.md`).

## 1. Value proposition

**One sentence:** Sanction is the authorization, secrets, and audit layer an autonomous agent calls *before* it spends money or touches a credential — so you can let agents act without letting them act without limits.

**One paragraph:** Builders can ship an agent in a weekend, but they can't safely give it a credit card, an API key, or production secrets — because there's no clean way to say "this agent may spend up to $X/day, may only touch *these* secrets, only for the next 15 minutes, and log every time it does." Sanction is that control plane: a policy engine that approves/denies/escalates spend, an AES-256-GCM vault that releases secrets only against a short-lived, scoped execution token, and an immutable-by-intent audit trail of every decision and injection. It plugs in over plain REST, an MCP server, or an AWS Bedrock action group, so it works regardless of how the agent was built.

## 2. The job to be done

> "I have an agent that needs to *act in the world* — spend, authenticate to a third party, run code with secrets — and I (or my security team / my customer) won't allow it until there are enforceable limits and an audit trail."

Decomposed JTBD:
- **Constrain spend** without hand-coding budget logic into every agent.
- **Hand an agent a secret** without that secret living in the agent's prompt, memory, logs, or env forever.
- **Prove what happened** — which agent accessed what, when, for how much — to a security reviewer or auditor.
- **Escalate the risky stuff** to a human instead of blanket-allowing or blanket-denying.

## 3. ICP (ideal customer profile)

Ranked by how acutely they feel the pain today:

1. **Agent-platform / agent-tooling builders** (A2A/MCP ecosystem, vertical-agent startups) who are *selling* autonomy and immediately hit "how do we let the agent pay / use the customer's secrets safely?" — Sanction is infrastructure they'd rather buy than build. **Best wedge.**
2. **Teams running internal autonomous agents** (ops/devops/research automation, e.g. the sibling **AIIA** Mac-mini agent) that already spend on LLM tokens and tools and want budgets + a credential vault without standing up Vault.
3. **Security/platform teams at mid-market companies** piloting agents who need to put governance in front of them before approving production use. (Longer sales cycle; needs SOC 2.)

**Non-ICP today:** regulated enterprises that need fund custody/money-movement (Sanction doesn't move money), and hobbyists (pain not acute enough to pay).

## 4. Core user journeys

**A. Owner sets up governance (management plane)**
`POST /wallets` → wallet + default policy → `POST /agents` → agent API key (shown once) → `POST /credentials/vault` to store secrets, scoped to specific agents.
> ⚠ Friction/Risk: today these endpoints are **unauthenticated** (see SECURITY-THREAT-MODEL F1–F4). There is also **no endpoint to edit a policy** or **assign clearance** — defaults only, or hand-edit the DB. This journey is the weakest part of the product.

**B. Agent spends (data plane, REAL):**
`POST /authorize {action, amount_usd, merchant, category}` → `approved` | `denied` | `escalated`, persisted to the audit log. Works well; this is the demo that lands.

**C. Agent uses a secret (data plane, REAL):**
`POST /exec {scope, budget_usd, ttl}` → short-lived JWT → pass to subprocess/container → `POST /credentials/inject {credential_label}` with `Authorization: Bearer <jwt>` → decrypted value, audit row written. The differentiated, well-built path.

**D. Owner observes:** dashboard (`/`) shows today/MTD token cost, approved spend, recent auth + token logs, pending approvals.
> ⚠ Bug: dashboard reads `PROXY_WALLET_ID`, docs say `SANCTION_WALLET_ID` (see DISCOVERY §7). And **escalated requests have no resolution UI/endpoint** — "pending approvals" is a dead end today.

## 5. Developer experience walkthrough (zero → governed agent)

Verified happy path against the code:

```bash
# 1. Create a wallet (returns wallet_id)
curl -XPOST $API/wallets -d '{"name":"Acme","owner_email":"me@acme.com"}'

# 2. Register an agent (returns api_key ONCE)
curl -XPOST $API/agents -d '{"wallet_id":"<id>","name":"researcher"}'

# 3. Store a scoped credential
curl -XPOST $API/credentials/vault -d '{"wallet_id":"<id>","label":"openai","type":"api_key","value":"sk-...","allowed_agent_ids":["<agentId>"]}'

# 4. Agent authorizes a spend
curl -XPOST $API/authorize -H "x-api-key: pxy_..." -d '{"action":"purchase","amount_usd":12,"merchant":"GitHub","category":"software"}'

# 5. Agent requests execution + injects the secret
curl -XPOST $API/exec -H "x-api-key: pxy_..." -d '{"scope":["openai"],"budget_usd":5}'
curl -XPOST $API/credentials/inject -H "Authorization: Bearer <jwt>" -d '{"credential_label":"openai"}'
```

**Time to value:** ~5 API calls / a few minutes. The *concepts* are clean and the MCP server makes it one config block for a Claude/AIIA host.

**Friction inventory (ordered):**
1. **No SDK** — raw REST/curl only. A `@sanction/sdk` (TS + Python) would cut integration time and encode the two-step exec→inject correctly.
2. **No policy/clearance management API** — you cannot change a budget or grant clearance without touching the DB. The product's headline knobs aren't user-settable.
3. **No escalation resolution** — escalated requests can't be approved/denied via API or UI.
4. **Management endpoints unauthenticated** — blocks any real multi-tenant use and is a security stopper (F1–F4).
5. **`wallet_id` discovery** — the dashboard expects an env var, fine for single-tenant, but there's no console to find your wallet/agent ids after creation.
6. **Naming drift** — "AutoFlux"/"proxy"/`pxy_`/`PROXY_WALLET_ID` leak through; erodes trust in a security product where polish signals rigor.

## 6. README claims vs. reality

| README says | Reality |
|---|---|
| "Agent **Wallet**" / daily-monthly budgets | Spend **authorization** + audit. No funds movement; monthly budget not enforced (only daily). |
| "Clearance Levels 1–5, industry domain auth" | Modeled, stamped into JWT, **never enforced**; no assignment endpoint. |
| Scoped exec JWT "within a capped budget" | TTL + scope enforced; **budget not enforced** (`spentUsd` unused). |
| Base URL `https://onesanction.com/api/v1` | Live and serving. |
| `npx sanction-mcp` | bin exists in `package.json`; npm publication unverified. |
| Pricing tiers (Free/Pro/Team/Enterprise) | No billing code; tiers unenforced (Stripe dep unused). |

**Takeaway:** the *authorization* and *credential-injection* stories are real and good; the *wallet*, *clearance*, *per-execution budget*, and *pricing* stories are ahead of the build. Tighten the narrative to what's enforced, then ship the rest behind it.
