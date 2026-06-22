# sanction-mcp

**Spend authorization, token budgets, and a credential vault for autonomous AI agents — over MCP.**

Give your agent a [Sanction](https://onesanction.com) key instead of your credit card.
Before it buys anything, calls a paid API, or touches a secret, it asks Sanction — which
approves, escalates to you, or denies based on the policy you set. Every decision is logged.

Even if your agent is hijacked at runtime, it can't spend, leak, or act beyond the limits
you set — the budget cap, per-transaction limit, clearance gate, and short-lived scoped
tokens bound the blast radius.

This package is a thin stdio MCP client for the hosted Sanction API at `onesanction.com`.

## Quickstart

### 1. Get a key (self-serve, ~60s)

```bash
# Create a wallet — returns a management key (sk_...) and a wallet id. Save both;
# the management key is shown only once.
curl -s -X POST https://onesanction.com/api/v1/wallets \
  -H "content-type: application/json" \
  -d '{"name":"My Wallet","owner_email":"you@example.com"}'

# Create an agent under that wallet — returns its API key (pxy_...), shown once.
# Use the management key from step 1 as x-mgmt-key, and the wallet id as wallet_id.
curl -s -X POST https://onesanction.com/api/v1/agents \
  -H "content-type: application/json" \
  -H "x-mgmt-key: sk_REPLACE_ME" \
  -d '{"wallet_id":"REPLACE_WITH_WALLET_ID","name":"My Agent"}'
```

You now have a `pxy_...` agent key (→ `SANCTION_API_KEY`) and a wallet id
(→ `SANCTION_WALLET_ID`).

### 2. Add to your MCP host

```json
{
  "mcpServers": {
    "sanction": {
      "command": "npx",
      "args": ["sanction-mcp"],
      "env": {
        "SANCTION_API_KEY": "pxy_...",
        "SANCTION_WALLET_ID": "<wallet_id>"
      }
    }
  }
}
```

Works with any MCP host — Claude Code, Claude Desktop, Cursor. No install needed; `npx`
fetches it on first run.

## Tools

| Tool | What it does |
|------|--------------|
| `sanction_authorize` | Ask before any purchase/subscription/transfer. Returns approve / escalate / deny. |
| `sanction_log_tokens` | Record LLM token usage against the daily token budget. |
| `sanction_request_execution` | Issue a short-lived, scoped JWT with a hard spend cap. |
| `sanction_inject_credential` | Retrieve a vaulted secret with that JWT (audit-logged). |
| `sanction_wallet_status` | Today/MTD token + spend totals and pending approvals. |

## Configuration

| Env | Required | Default |
|-----|----------|---------|
| `SANCTION_API_KEY` | yes | — |
| `SANCTION_WALLET_ID` | no (needed for `sanction_wallet_status`) | — |
| `SANCTION_API_URL` | no | `https://onesanction.com/api/v1` |

## Set a spend policy

New wallets start with sane defaults (auto-approve under $10, escalate over $25, hard-cap
at $50/txn, $50/day). Tune per-agent limits and clearance with the management key — see the
[full quickstart and examples](https://github.com/ericlovold/sanction/blob/main/examples/README.md).

## License

MIT
