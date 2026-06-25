# Sanction

**The trust and governance layer for autonomous AI agents.**

Sanction gives agents a wallet, a credential vault, and a clearance system — so they can act autonomously without acting without limits.

---

## What It Does

Autonomous agents need permission to spend money, access credentials, and operate in sensitive domains. Sanction is the layer that grants that permission, enforces policy, and logs everything.

| Pillar | Capability |
|--------|-----------|
| **Agent Wallet** | Spend authorization with configurable policy. Auto-approve under threshold, escalate over it, deny what's blocked. Daily and monthly budgets per agent. |
| **Credential Vault** | AES-256-GCM encrypted secrets. Scoped execution JWTs (15-minute TTL) gate every injection. Every access is audit-logged. |
| **Clearance Levels** | 1–5 clearance system for domain authorization. Agents only access what they're cleared for. |

---

## Distribution

Sanction is available through three channels:

- **MCP Server** — drop into any Claude Desktop, AIIA, or MCP-compatible agent host
- **REST API** — direct integration via `x-api-key` auth
- **AWS Bedrock Action Group** — enterprise agent orchestration (`agentId: JXRNIJRMCX`, us-east-1)

---

## API

Base URL: `https://getsanction.com/api/v1`

**Integrating a multi-tenant platform?** Start with the
[Multi-Tenant Integration Runbook](docs/INTEGRATION.md) — provision an agent per
tenant, govern budgets centrally, meter LLM calls through the gateway, rotate keys.
Using the Vercel AI SDK? See the [AI SDK guide](docs/VERCEL-AI-SDK.md).

```
POST  /wallets               — Create a wallet (master account) + spend policy
GET   /wallets/stats         — Dashboard stats (today + MTD)
GET   /wallets/policy        — Read the wallet spend policy
PATCH /wallets/policy        — Update budgets, thresholds, categories
POST  /agents                — Register (provision) an agent under a wallet
GET   /agents                — List a wallet's agents
PATCH /agents                — Per-agent budgets, clearance, revoke/reactivate
POST  /agents/rotate         — Rotate an agent's key (old dies immediately)
POST  /authorize             — Authorize a spend action before any transaction
POST  /tokens                — Log LLM token consumption for budget tracking
POST  /exec                  — Issue a scoped execution JWT (15-min TTL)
POST  /credentials/vault     — Store an encrypted credential
POST  /credentials/inject    — Inject a decrypted credential (requires JWT)
GET   /api/openapi.json      — OpenAPI 3.0 spec (Bedrock compatible)
```

The LLM gateway lives at `https://getsanction.com/api/gateway/<provider>` (point
your model SDK's base URL there, send `x-sanction-key`).

### Auth

Agent API calls use `x-api-key: pxy_...` header. Credential injection requires a short-lived Bearer JWT issued by `/exec`.

---

## MCP Setup

```json
{
  "mcpServers": {
    "sanction": {
      "command": "npx",
      "args": ["sanction-mcp"],
      "env": {
        "SANCTION_API_URL": "https://getsanction.com/api/v1",
        "SANCTION_API_KEY": "pxy_...",
        "SANCTION_WALLET_ID": "wallet_..."
      }
    }
  }
}
```

---

## Stack

- **Next.js 16** (App Router) + TypeScript
- **Neon** (serverless Postgres) via Prisma 7
- **Vercel** deployment
- **jose** for JWT signing (HS256)
- **Node crypto** for AES-256-GCM encryption

---

## Pricing

| Tier | Price | Agents | Token Budget |
|------|-------|--------|-------------|
| Free | $0 | 1 | $10/mo |
| Pro | $19/mo | 5 | $100/mo |
| Team | $49/mo | 25 | $500/mo |
| Enterprise | Custom | Unlimited | Custom |

---

## License

- **`packages/sanction-mcp`** (the MCP client) — [MIT](packages/sanction-mcp/LICENSE). Embed it anywhere.
- **Everything else** (server, dashboard, API) — [Functional Source License 1.1](LICENSE) (FSL-1.1-MIT). Source-available: use and self-host it for any purpose except offering a competing service. Converts to MIT two years after release.
