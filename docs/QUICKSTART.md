# Sanction Quickstart — first call in under 5 minutes

> Create a wallet, issue an agent key, route an LLM call through the gateway so it's
> metered, and authorize a spend before it happens. Base URL: `https://getsanction.com/api/v1`.
> Full API: [OpenAPI spec](https://getsanction.com/api/openapi.json).

---

## 1. Create a wallet

A wallet is your master account. You get back a **management key** (`sk_…`) — save it, it's shown once.

```bash
curl -s -X POST https://getsanction.com/api/v1/wallets \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-org",
    "owner_email": "you@example.com"
  }' | jq .
```

Response (abbreviated):

```json
{ "id": "wal_abc123", "management_key": "sk_live_...", "warning": "Store this key now." }
```

## 2. Register an agent & get a key

Use your `sk_` management key to provision an agent. You get back an **agent key** (`pxy_…`) — also shown once.

```bash
curl -s -X POST https://getsanction.com/api/v1/agents \
  -H "Content-Type: application/json" \
  -H "x-mgmt-key: sk_live_YOUR_MGMT_KEY" \
  -d '{
    "wallet_id": "wal_abc123",
    "name": "my-first-agent"
  }' | jq .
```

Response:

```json
{ "id": "agt_xyz", "api_key": "pxy_live_...", "warning": "Store this key now." }
```

## 3. Route an LLM call through the gateway

Swap your provider's base URL for the Sanction gateway. Pass your agent key in `x-sanction-key`; your own provider key still rides along and is forwarded upstream.

```bash
# Claude via Sanction gateway
curl -s -X POST https://getsanction.com/api/gateway/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-sanction-key: pxy_live_YOUR_AGENT_KEY" \
  -H "x-api-key: YOUR_ANTHROPIC_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 256,
    "messages": [{"role":"user","content":"Say hello"}]
  }'
```

The gateway meters tokens and cost automatically — they show up in your dashboard. When a daily token budget is exhausted, the gateway returns **402 before the call reaches the provider**.

## 4. Authorize a spend action

Before any financial action, ask Sanction for permission.

```bash
curl -s -X POST https://getsanction.com/api/v1/authorize \
  -H "Content-Type: application/json" \
  -H "x-api-key: pxy_live_YOUR_AGENT_KEY" \
  -d '{
    "action": "purchase",
    "amount_usd": 29.99,
    "merchant": "GitHub",
    "category": "software",
    "description": "Copilot subscription"
  }' | jq .
```

Response:

```json
{
  "authorized": true,
  "status": "approved",
  "request_id": "req_...",
  "agent": "agt_xyz",
  "amount_usd": 29.99,
  "merchant": "GitHub"
}
```

Handle every status: `approved` (proceed), `denied` (stop), `escalated` (wait for a human).

## 5. Log token usage (optional — the gateway does this automatically)

If you call an LLM directly instead of through the gateway, log usage manually:

```bash
curl -s -X POST https://getsanction.com/api/v1/tokens \
  -H "Content-Type: application/json" \
  -H "x-api-key: pxy_live_YOUR_AGENT_KEY" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "tokens_in": 150,
    "tokens_out": 42,
    "cost_usd": 0.0012,
    "task": "greeting"
  }'
```

---

## Next steps

- **Set a spend policy:** `PATCH /wallets/policy` — daily budgets, auto-approve thresholds, escalation rules.
- **Credential vault:** `POST /exec` to issue scoped JWTs, then `POST /credentials/inject`.
- **Dashboard:** `GET /wallets/stats?wallet_id=<id>` or visit [getsanction.com](https://getsanction.com).
- **Framework guides:** [Vercel AI SDK](./vercel-ai-sdk.md) · [LangChain](./langchain.md) · [CrewAI](./crewai.md)
