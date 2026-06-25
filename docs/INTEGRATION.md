# Sanction — Multi-Tenant Integration Runbook

> For platforms that provision many agents under one account (one agent per
> tenant), govern spend from a single place, and meter LLM calls through the
> gateway. Every endpoint here is in the live spec at
> `https://getsanction.com/api/openapi.json`.

---

## Mental model

- **Wallet** = your master account. One per platform. Holds the spend **policy**
  (the ceiling for everything below it) and the **management key** (`sk_`).
- **Agent** = a scoped identity under the wallet — **one per tenant.** Holds a
  data-plane key (`pxy_`) and optional per-tenant budget overrides.
- **Two planes, two keys** (don't mix them up):
  | Plane | Key | Header | Used for | Where it lives |
  |---|---|---|---|---|
  | **Management** | `sk_…` | `x-mgmt-key` | provision agents, set budgets, rotate keys | **server-side only** |
  | **Data** | `pxy_…` | `x-api-key` *and* `x-sanction-key` | a tenant authorizes spend + calls the gateway | per-tenant, server-side |
- **Gateway** = point your model SDK's base URL at Sanction; every call is metered
  and capped under that agent's (and the wallet's) budget.

> One subtlety: the **same** per-tenant `pxy_` key is sent as `x-api-key` to
> `/authorize` and as `x-sanction-key` to the gateway. Same secret, two header
> names — by design.

**Tenant mapping:** keep `tenantId` in your resolver and map it to **`agentId`**
(one master wallet, one agent per tenant). Encode the tenant in the agent `name`
(e.g. `tenant_<id>`) so it's legible in logs and the dashboard.

---

## One-time setup

### 1. Create the master wallet

```bash
curl -X POST https://getsanction.com/api/v1/wallets \
  -H "content-type: application/json" \
  -d '{"name":"Acme Platform","owner_email":"ops@acme.com"}'
```

Returns once — store both as secrets:
- `id` → your **`WALLET_ID`**
- `management_key` (`sk_…`) → your **`SK`** (shown once; gates every management call)

### 2. Set the wallet policy (the platform-wide ceiling)

```bash
curl -X PATCH https://getsanction.com/api/v1/wallets/policy \
  -H "x-mgmt-key: $SK" -H "content-type: application/json" \
  -d '{"wallet_id":"'$WALLET_ID'",
       "daily_spend_budget_usd": 5000,
       "per_transaction_max_usd": 200,
       "auto_approve_under_usd": 20,
       "escalate_over_usd": 200,
       "blocked_categories": ["gambling","crypto"]}'
```

This caps the **entire platform**. Per-tenant overrides (step 4) tighten it
further but can never exceed it.

---

## Per-tenant provisioning (automate this)

### 3. Provision an agent for a tenant

```bash
curl -X POST https://getsanction.com/api/v1/agents \
  -H "x-mgmt-key: $SK" -H "content-type: application/json" \
  -d '{"wallet_id":"'$WALLET_ID'","name":"tenant_42"}'
```

Returns once: `api_key` (`pxy_…`). Store it encrypted, mapped to `tenantId`.

### 4. Set the tenant's budget (optional override)

```bash
curl -X PATCH https://getsanction.com/api/v1/agents \
  -H "x-mgmt-key: $SK" -H "content-type: application/json" \
  -d '{"wallet_id":"'$WALLET_ID'","agent_id":"'$AGENT_ID'",
       "daily_spend_budget_usd": 100, "daily_token_budget_usd": 25}'
```

`null` on a field clears the override (inherit the wallet policy); omitting it
leaves it unchanged.

### Provisioning, in code (server-side)

```ts
// Runs with your management key — NEVER ship this key to a client.
async function provisionTenant(tenantId: string, dailyUsd: number) {
  const res = await fetch("https://getsanction.com/api/v1/agents", {
    method: "POST",
    headers: { "x-mgmt-key": process.env.SANCTION_MGMT_KEY!, "content-type": "application/json" },
    body: JSON.stringify({ wallet_id: process.env.SANCTION_WALLET_ID, name: `tenant_${tenantId}` }),
  })
  const { id: agentId, api_key } = await res.json()

  await fetch("https://getsanction.com/api/v1/agents", {
    method: "PATCH",
    headers: { "x-mgmt-key": process.env.SANCTION_MGMT_KEY!, "content-type": "application/json" },
    body: JSON.stringify({ wallet_id: process.env.SANCTION_WALLET_ID, agent_id: agentId, daily_spend_budget_usd: dailyUsd }),
  })

  await saveTenantAgent(tenantId, { agentId, agentKey: api_key }) // encrypt at rest
}
```

---

## Runtime

### 5. Meter LLM calls through the gateway

Point your model SDK at Sanction and send the tenant's key. You keep using your
own provider key — Sanction meters + caps, then forwards.

```ts
import OpenAI from "openai"

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,                       // your key — forwarded
  baseURL: "https://getsanction.com/api/gateway/openai/v1", // OpenAI SDK needs /v1
  defaultHeaders: { "x-sanction-key": tenantAgentKey },     // the tenant's pxy_ key
})
```

Base URLs per provider: `/api/gateway/anthropic`, `/api/gateway/openai/v1`,
`/api/gateway/gemini`. If the daily token budget is exhausted, the gateway
returns **402** before the call goes out.

> Using the **Vercel AI SDK**? See [VERCEL-AI-SDK.md](VERCEL-AI-SDK.md) — same
> idea (`baseURL` + `x-sanction-key`), with the per-provider config and the
> per-request tenant-key pattern.

### 6. (Optional) authorize non-LLM spend

Before a purchase/subscription/transfer, ask first:

```bash
curl -X POST https://getsanction.com/api/v1/authorize \
  -H "x-api-key: $TENANT_PXY" -H "content-type: application/json" \
  -d '{"action":"purchase","amount_usd":5,"merchant":"OpenAI","category":"software"}'
```

Returns `approved` / `escalated` / `denied` with a stable machine-readable `code`
to branch on. Add `?simulate=true` to dry-run a decision without recording it.

---

## Lifecycle

- **Rotate a tenant's key** (old dies immediately, new shown once):
  ```bash
  curl -X POST https://getsanction.com/api/v1/agents/rotate \
    -H "x-mgmt-key: $SK" -H "content-type: application/json" \
    -d '{"wallet_id":"'$WALLET_ID'","agent_id":"'$AGENT_ID'"}'
  ```
- **Suspend / revoke a tenant** (and reactivate):
  ```bash
  curl -X PATCH https://getsanction.com/api/v1/agents \
    -H "x-mgmt-key: $SK" -H "content-type: application/json" \
    -d '{"wallet_id":"'$WALLET_ID'","agent_id":"'$AGENT_ID'","active":false}'
  ```

---

## Account tree — nesting tenants (optional)

For an org that wants budgets and reporting to roll up a hierarchy (division →
team → tenant), wallets can nest. A sub-account is a wallet with a `parent_id`;
creating one requires the parent's management key.

Create a sub-account under a master wallet:

```bash
curl -X POST https://getsanction.com/api/v1/wallets \
  -H "x-mgmt-key: $PARENT_SK" -H "content-type: application/json" \
  -d '{"name":"Clinic 12","owner_email":"clinic12@acme.com","parent_id":"'$PARENT_WALLET_ID'"}'
```

You get the sub-account's own `id` and management key — provision agents and set
policy under it exactly as you would a root wallet.

Read spend rolled up across the whole subtree:

```bash
curl -s "https://getsanction.com/api/v1/wallets/tree?wallet_id=$PARENT_WALLET_ID" \
  -H "x-mgmt-key: $PARENT_SK" | jq
```

Each node reports its own `spend` and a `rollup` (itself + every descendant) for
today, the month, and token cost — the one-number-for-the-fleet view.

> Today this is **structure + reporting**. Cascade *enforcement* — a parent cap
> that hard-limits its whole subtree — is the next slice. Budgets are still set
> and enforced per wallet/agent for now.

## Degradation (design your circuit breaker)

The gateway is **in-path and fail-closed** today — if Sanction is down, the call
doesn't pass through. There is **no formal SLA yet**. Recommended client default:
**fail-open-with-alert** — on a gateway error or latency-budget breach, fall back
to calling the provider **directly** (you hold the provider key). Design the
breaker now; that direct-fallback path goes away if/when you move to
provider-key vaulting (roadmap), so keep it behind a flag.

## Data handling / PHI

The gateway persists **metadata only** (tokens, model, cost, timestamp) — never
prompt/response bodies, never logged. **Do not** put PHI in the `/authorize`
`description` field (that one persists). Non-PHI agents (e.g. SEO/GEO): start
today. Raw PHI through the gateway requires a BAA + the HIPAA-isolated gateway
(deal-triggered — talk to us).

## Security checklist

- Management key (`sk_`) is **server-side only** — never a browser, never a client bundle.
- One `pxy_` key per tenant; store encrypted; it's shown once.
- Rotate on any suspicion (`POST /agents/rotate`); suspend with `{active:false}`.
- Wallet creation is rate-limited (15/hr/IP) — create the **one** master wallet, then provision agents under it.
