# Three governed workflows

Sanction authorizes the spend; any rail settles it. Start with one of these
three integration paths. Each puts the same decision engine in front of a
different irreversible action.

## 1. Govern MCP tools before they run

Put the hosted broker in front of an MCP server. Sanction authorizes every
`tools/call` before forwarding it; the upstream token stays vaulted and never
enters an agent configuration.

### Set up the broker

Register an upstream once with the wallet owner's management key:

```bash
curl -X POST https://getsanction.com/api/v1/broker/upstreams \
  -H "x-mgmt-key: $SANCTION_MGMT_KEY" \
  -H "content-type: application/json" \
  -d '{
    "wallet_id": "'$SANCTION_WALLET_ID'",
    "name": "github",
    "url": "https://mcp.example.com",
    "auth_header": "Authorization",
    "auth_value": "Bearer upstream-token"
  }'
```

Point the MCP host at `https://getsanction.com/mcp/broker/github` and give it
only the agent's `pxy_` key. Sanction injects the upstream credential when it
forwards a permitted call.

```json
{
  "mcpServers": {
    "github": {
      "url": "https://getsanction.com/mcp/broker/github",
      "headers": { "x-api-key": "pxy_your_agent_key" }
    }
  }
}
```

### Start with a restrictive policy

```bash
curl -X PATCH https://getsanction.com/api/v1/wallets/policy \
  -H "x-mgmt-key: $SANCTION_MGMT_KEY" \
  -H "content-type: application/json" \
  -d '{
    "wallet_id": "'$SANCTION_WALLET_ID'",
    "blocked_tools": ["delete_repo"],
    "escalate_tools": ["merge_pull_request", "deploy"]
  }'
```

The broker returns a normal MCP tool result on refusal, so the host can give
the model a planning outcome instead of retrying a protocol error:

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "content": [{ "type": "text", "text": "DENIED (TOOL_BLOCKED)" }],
    "isError": true
  }
}
```

An escalated call creates a pending approval. After approval, retry that exact
`tools/call` once with `_meta["sanction/grant_id"]`; the grant is consumed
atomically.

### What Sanction does not do

Sanction is not an MCP server replacement and does not execute tools. It
decides whether a registered upstream may receive the call. Non-`tools/call`
traffic is forwarded, and an unrecognized payment challenge is passed through.

## 2. Cap AI spend by team without instrumenting every call

Make departments child wallets, give each runtime an agent key, and route its
model client through the gateway. The gateway meters usage from provider
responses and stops an over-budget request before it reaches the provider.

### Build the budget tree

Create a child wallet for a team, then set the organization cap and the team's
token budget:

```bash
curl -X POST https://getsanction.com/api/v1/wallets \
  -H "x-mgmt-key: $ORG_MGMT_KEY" \
  -H "content-type: application/json" \
  -d '{"name":"Platform","owner_email":"platform@example.com","parent_id":"'$ORG_WALLET_ID'"}'

curl -X PATCH https://getsanction.com/api/v1/wallets/policy \
  -H "x-mgmt-key: $ORG_MGMT_KEY" \
  -H "content-type: application/json" \
  -d '{"wallet_id":"'$ORG_WALLET_ID'","subtree_daily_cap_usd":500}'

curl -X PATCH https://getsanction.com/api/v1/wallets/policy \
  -H "x-mgmt-key: $PLATFORM_MGMT_KEY" \
  -H "content-type: application/json" \
  -d '{"wallet_id":"'$PLATFORM_WALLET_ID'","daily_token_budget_usd":100}'
```

Route an Anthropic client through Sanction. The provider key remains yours.

```python
from anthropic import Anthropic

client = Anthropic(
    base_url="https://getsanction.com/api/gateway/anthropic",
    api_key="YOUR_ANTHROPIC_KEY",
    default_headers={"x-sanction-key": "pxy_platform_agent"},
)
```

When the applicable agent, wallet, or ancestor cap is exhausted, the gateway
returns `402` before forwarding the model request. Finance can read the team
tree and download a signed audit export:

```bash
curl "https://getsanction.com/api/v1/wallets/tree?wallet_id=$ORG_WALLET_ID" \
  -H "x-mgmt-key: $ORG_MGMT_KEY"

curl "https://getsanction.com/api/v1/audit/export?wallet_id=$ORG_WALLET_ID" \
  -H "x-mgmt-key: $ORG_MGMT_KEY" > sanction-evidence.json
```

### What Sanction does not do

Sanction meters provider-reported usage; it does not replace the model provider
or hold the provider credential. Streaming calls remain live once bytes begin
flowing, so a post-stream meter-write failure can leave one call under-counted.

## 3. Authorize x402 before the wallet signs

An x402 `402 Payment Required` is a demand for money. Send the challenge to
Sanction before your wallet signs it. Sanction prices supported USD-pegged
stablecoin quotes, authorizes the worst case across payment options, and stores
the settlement metadata with the decision.

Set an explicit payment policy first. Include `api` when the wallet uses an
allowed-category list: it is the x402 quote route's default category.

```bash
curl -X PATCH https://getsanction.com/api/v1/wallets/policy \
  -H "x-mgmt-key: $SANCTION_MGMT_KEY" \
  -H "content-type: application/json" \
  -d '{
    "wallet_id": "'$SANCTION_WALLET_ID'",
    "auto_approve_under_usd": 0.25,
    "escalate_over_usd": 10,
    "per_transaction_max_usd": 50,
    "allowed_categories": ["api"]
  }'
```

```bash
curl -X POST https://getsanction.com/api/v1/authorize/quote \
  -H "x-api-key: $SANCTION_AGENT_KEY" \
  -H "content-type: application/json" \
  -d '{
    "challenge": {
      "x402Version": 1,
      "accepts": [{
        "scheme": "exact",
        "network": "base",
        "maxAmountRequired": "50000",
        "asset": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "payTo": "0xrecipient"
      }]
    },
    "category": "api"
  }'
```

An approved response includes the priced quote and settlement metadata. Sign
and resend only after `authorized: true`. A denied or escalated result is a
stop-or-wait outcome, not a payment instruction.

When the paid upstream sits behind the MCP broker, Sanction also intercepts its
402 response. On any refusal the broker withholds `payTo` and payment amounts,
so the agent never receives requirements it could sign.

### What Sanction does not do

Sanction never holds keys, signs, initiates transfers, or estimates exchange
rates. It prices only supported USD-pegged stablecoins with known decimals;
unpriceable challenges are denied. It authorizes a quote, not confirmation that
settlement completed; receipt reconciliation is a separate concern.
