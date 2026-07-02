# Agent-platform starter kit

**Launch agents anywhere. Govern them in Sanction.** This is the one recipe every
agent builder can copy — whatever your runtime (Claude Code, Cursor, an MCP host,
Bedrock, LangChain, CrewAI, or something you wrote yourself):

> **Before any spend, tool call, credential use, or provisioning action, ask
> Sanction. If it's approved — act. If it's escalated — wait for the human's
> one-use grant, then retry the exact same request with it. If it's denied —
> read the machine code, replan or stop. Never act on an ambiguous answer.**

Everything below is that loop, three ways: raw REST, MCP tools, and webhooks.

## 0. Setup (60 seconds)

```bash
# Create a wallet (returns a management key sk_… — keep it out of agent hands)
curl -X POST https://getsanction.com/api/v1/wallets \
  -H "content-type: application/json" \
  -d '{"name": "my-org", "owner_email": "you@company.com"}'

# Register an agent (returns its pxy_… key — this is the agent's identity)
curl -X POST https://getsanction.com/api/v1/agents \
  -H "x-mgmt-key: sk_…" -H "content-type: application/json" \
  -d '{"wallet_id": "<wallet_id>", "name": "prod-agent"}'
```

The agent holds only its `pxy_` key. Budgets, thresholds, and allow/block lists
live in the wallet policy — the agent can't see or change them.

## 1. The loop, over REST

One decision endpoint per action kind, all with the same contract:

| Action | Endpoint |
|---|---|
| Spend money | `POST /api/v1/authorize` |
| Invoke a tool | `POST /api/v1/authorize/tool` |
| Provision resources (seats, licenses, infra) | `POST /api/v1/authorize/provision` |
| Use a secret | `POST /api/v1/exec` → `POST /api/v1/credentials/inject` |

```ts
async function authorizeSpend(req: {
  action: "purchase" | "subscribe" | "transfer"
  amount_usd: number
  merchant: string
  category: string
  description?: string
  grant_id?: string // set on retry after a human approval
}) {
  const res = await fetch("https://getsanction.com/api/v1/authorize", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.SANCTION_API_KEY!, // pxy_…
      "idempotency-key": crypto.randomUUID(),     // retries can never double-spend
    },
    body: JSON.stringify(req),
  })
  return res.json()
}

const d = await authorizeSpend({ action: "purchase", amount_usd: 62.5, merchant: "Azure", category: "infrastructure" })

if (d.authorized) {
  // ACT. d.request_id is your audit reference.
} else if (d.status === "escalated") {
  // WAIT for the human (section 2), then retry the EXACT same request + grant_id.
} else {
  // DENIED. d.code is machine-stable (CATEGORY_BLOCKED, PER_TXN_LIMIT,
  // DAILY_BUDGET_EXCEEDED, …) and d.remediation says how to replan. Stop or replan.
}
```

Provisioning is the same loop with a native shape — resource + line item +
quantity + dollars in one call:

```json
POST /api/v1/authorize/provision
{ "resource": "azure.seat", "line_item": "Microsoft 365 E3",
  "quantity": 5, "unit_price_usd": 12.50, "amount_usd": 62.50,
  "category": "licenses" }
```

## 2. Waiting for the human (the grant loop)

An `escalated` decision paused in the owner's approval inbox. Approval mints a
**one-use grant**. Two ways to learn about it:

**Poll** (simplest — the endpoint settles timeouts, so you always reach a
terminal state):

```ts
const d = await fetch(`https://getsanction.com/api/v1/authorize/${request_id}`, {
  headers: { "x-api-key": process.env.SANCTION_API_KEY! },
}).then((r) => r.json())

if (d.authorized && d.grant?.id) {
  // Retry the ORIGINAL request with grant_id: d.grant.id — every field must
  // match what the owner approved, or it's denied GRANT_MISMATCH.
}
```

**Push** (webhooks — section 4): listen for `approval.resolved`; the payload
carries `grant_id`.

Grants are one-use and short-lived (15 minutes by default). A consumed, expired,
or mismatched grant is a clean deny with a `GRANT_*` code — never re-mint one
yourself; ask again.

## 3. The loop, over MCP

If your runtime speaks MCP, skip the REST and mount the tools:

```json
{
  "mcpServers": {
    "sanction": {
      "command": "npx",
      "args": ["sanction-mcp"],
      "env": { "SANCTION_API_KEY": "pxy_…", "SANCTION_WALLET_ID": "<wallet_id>" }
    }
  }
}
```

That exposes `sanction_authorize`, `sanction_authorize_tool`,
`sanction_authorize_provision`, `sanction_log_tokens`,
`sanction_request_execution`, `sanction_inject_credential`, and
`sanction_wallet_status`. Then give the agent one standing rule — in its system
prompt, agent definition, or platform policy:

> Before any purchase, tool invocation, provisioning action, or secret use, call
> the matching `sanction_*` tool first. Never proceed when it returns
> `authorized: false`. When it returns `escalated`, wait for approval and retry
> the identical request with the `grant_id`.

The tool descriptions repeat this contract, so most agents follow it unprompted
— the rule makes it policy rather than a suggestion.

## 4. Webhooks — approvals that find you

Register once (management plane):

```bash
curl -X POST https://getsanction.com/api/v1/webhooks \
  -H "x-mgmt-key: sk_…" -H "content-type: application/json" \
  -d '{"wallet_id": "<wallet_id>", "url": "https://yourapp.com/hooks/sanction"}'
# → returns a signing secret. Store it.
```

Events: `approval.created`, `approval.resolved` (carries `grant_id`),
`escalation.created`, `escalation.resolved`, `budget.threshold` (the 80% early
warning — fires before anything is denied), and opt-in `budget.exhausted`.

Verify every delivery — the signature is HMAC-SHA256 over the exact raw body:

```ts
import { createHmac, timingSafeEqual } from "node:crypto"

function verify(rawBody: string, header: string, secret: string) {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex")
  return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected))
}
```

## 5. The rules that keep you safe

1. **Fail closed.** No response, a timeout, or a non-JSON body is a deny. Never
   "assume approved" on transport failure.
2. **Idempotency keys on every authorize.** Retries return the original
   decision; concurrent duplicates can't double-spend.
3. **Exact retry with grants.** The grant matches the approved request
   field-for-field. Don't "round up" after approval.
4. **The agent never holds the management key.** `sk_` provisions and configures;
   `pxy_` acts. Compromising the agent must never mean compromising the policy.
5. **Log LLM usage** (`POST /v1/tokens` or route through [the gateway](/docs/quickstart))
   so token burn counts against the same daily budgets the CFO sees.

Full API reference: [openapi.json](/api/openapi.json) · Framework guides:
[Vercel AI SDK](/docs/ai-sdk) · [LangChain](/docs/langchain) · [CrewAI](/docs/crewai)
