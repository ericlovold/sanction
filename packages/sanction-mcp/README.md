# sanction-mcp

**Approval and budget checks for AI agents — over MCP.**

Give your agent a [Sanction](https://getsanction.com) key instead of your credit card.
Before it buys anything, calls a paid API, or touches a secret, it asks Sanction — which
approves, escalates to you, or denies based on the policy you set. Every decision is logged.

A short-lived mandate (`sanction_request_execution`) is what you hand a child agent or a
counterparty — never the root key. They check it at `POST /mandate/verify` with no API key.
stdio MCP is cooperative: the host must ask before acting. Prefer the hosted URL
when your host accepts remote MCP: `https://getsanction.com/mcp` with
`x-api-key: pxy_...`. The LLM gateway intercepts inference spend without
cooperation. The hosted broker at `/mcp/broker/<name>` intercepts `tools/call`.

This package is the stdio client. The hosted endpoint is the same wallet over
Streamable HTTP. Discovery: [Wallet Card](https://getsanction.com/.well-known/wallet-card.json).

## Hosted connection (no npm install)

Use `https://getsanction.com/mcp` with a secret `x-api-key` header containing
your agent key. Check the connection with `sanction_wallet_status` before
attempting any authorization. This is cooperative: adding the server does not
intercept other tools. See the [Grok Bot connection guide](https://github.com/ericlovold/sanction/blob/main/docs/GROK-BOT.md)
for setup boundaries and the broker path. Marketplace availability is separate
from endpoint availability.

## Quickstart

### 1. Get a key (self-serve, ~60s)

```bash
# Create a wallet — returns a management key (sk_...) and a wallet id. Save both;
# the management key is shown only once.
curl -s -X POST https://getsanction.com/api/v1/wallets \
  -H "content-type: application/json" \
  -d '{"name":"My Wallet","owner_email":"you@example.com"}'

# Create an agent under that wallet — returns its API key (pxy_...), shown once.
# Use the management key from step 1 as x-mgmt-key, and the wallet id as wallet_id.
curl -s -X POST https://getsanction.com/api/v1/agents \
  -H "content-type: application/json" \
  -H "x-mgmt-key: sk_REPLACE_ME" \
  -d '{"wallet_id":"REPLACE_WITH_WALLET_ID","name":"My Agent"}'
```

First verified email sign-in claims an API-created wallet and revokes pre-claim
agent access. Verify ownership before issuing long-lived client keys; see the
[quickstart](https://github.com/ericlovold/sanction/blob/main/docs/QUICKSTART.md).

You now have a `pxy_...` agent key (→ `SANCTION_API_KEY`) — the only
configuration the server needs.

### 2. Add to your MCP host

Remote (paste this when the host accepts a URL):

```json
{
  "mcpServers": {
    "sanction": {
      "url": "https://getsanction.com/mcp",
      "headers": { "x-api-key": "pxy_..." }
    }
  }
}
```

stdio (this package):

```json
{
  "mcpServers": {
    "sanction": {
      "command": "npx",
      "args": ["sanction-mcp"],
      "env": { "SANCTION_API_KEY": "pxy_..." }
    }
  }
}
```

Use the transport and secret-header configuration supported by your MCP host.

## Tools

| Tool | What it does |
|------|--------------|
| `sanction_authorize` | Ask before any purchase/subscription/transfer. Returns approve / escalate / deny. |
| `sanction_authorize_provision` | Ask before provisioning seats/licenses/infrastructure. Governs the resource and the dollars in one call. |
| `sanction_authorize_tool` | Ask before invoking another tool, shell command, deploy, or email send. Enforces the tool allow/block/escalate policy. |
| `sanction_authorize_capability` | Ask before acquiring a new capability — installing a skill/plugin, enabling an integration, calling a new API. Enforces the capability allow/block/escalate policy. |
| `sanction_check_authorization` | Poll an escalated request for its one-use grant. |
| `sanction_log_tokens` | Record LLM token usage against the daily token budget. |
| `sanction_log_outcome` | Record a confirmed business outcome (enrollment, booking, conversion). Feeds cost-per-outcome ceilings; idempotent via `dedupe_key`. |
| `sanction_request_execution` | Mint a short-lived mandate (JWT) for a child agent or counterparty. |
| `sanction_inject_credential` | Retrieve a vaulted secret under that mandate (audit-logged). |
| `sanction_wallet_status` | Today/MTD token + spend totals and pending approvals. |

## Configuration

| Env | Required | Default |
|-----|----------|---------|
| `SANCTION_API_KEY` | yes | — |
| `SANCTION_WALLET_ID` | no — `sanction_wallet_status` derives the wallet from the agent key; set only to override | — |
| `SANCTION_API_URL` | no | `https://getsanction.com/api/v1` |

## Set a spend policy

New wallets start with sane defaults (auto-approve under $10, escalate over $25, hard-cap
at $50/txn, $50/day). Tune per-agent limits and clearance with the management key — see the
[full quickstart and examples](https://github.com/ericlovold/sanction/blob/main/examples/README.md).

## License

MIT

## Upgrade to 0.10.0

This release adds `require_approval` and `approval_reason` to the existing
`sanction_authorize_tool` call. Request human review without editing policy;
existing hard denials still win. Approval produces an expiring, one-use grant
bound to the reviewed request. Retry the exact original authorization with that
grant before executing anything.

**Decision-contract change:** denial and waiting are normal MCP results
(`isError: false`). This is not permission. Read `authorized`, `status`, and
`next_action` from structured content or the matching JSON text block. Only
`authorized: true` permits the attempt. `wait` means pause; `retry_with_grant`
means redeem the original request; `stop` means do not act or automatically
request another approval. Transport errors also mean stop.

The package still exposes ten cooperative tools. Connecting it does not
intercept other tools, and consuming a grant is not proof of execution.

## Publishing this release

The package and Registry record target `0.10.0`. After merge and successful CI,
run the repository's **Publish MCP** workflow. It publishes npm first, then the
Registry using GitHub OIDC. An existing npm version is skipped on reruns.

Verify the published npm version and tool schema, then the Registry's latest
record, package version, hosted URL and required secret header. A merge or
Vercel deployment alone publishes neither artifact. Registry publication does
not imply acceptance in a host's curated marketplace.
