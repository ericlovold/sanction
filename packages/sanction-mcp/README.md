# sanction-mcp

**Spend authorization, token budgets, and a credential vault for autonomous AI agents — over MCP.**

Give your agent a [Sanction](https://getsanction.vercel.app) key instead of your credit card.
Before it buys anything, calls a paid API, or touches a secret, it asks Sanction — which
approves, escalates to you, or denies based on the policy you set. Every decision is logged.

## Install

No install needed — run via `npx`. Add to your MCP host config:

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

Get a key: create a wallet and agent against the API (see
[the quickstart](https://github.com/ericlovold/sanction/blob/main/examples/README.md)), or
`POST https://getsanction.vercel.app/api/v1/wallets`.

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
| `SANCTION_API_URL` | no | `https://getsanction.vercel.app/api/v1` |

## License

MIT
