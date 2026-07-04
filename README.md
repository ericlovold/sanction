# Sanction

**The authorization layer for autonomous AI agents.**

Before an agent spends money, invokes a tool, touches a credential, or
provisions a resource, it asks Sanction. Sanction decides — approve, escalate
to a human, or deny — and every decision is logged, auditable, and provable.

---

## What it does

One policy decision engine governs every kind of agent action:

| Governed action | What Sanction enforces |
|---|---|
| **Spend** (`/authorize`) | Auto-approve floor, human-escalation band, per-transaction hard cap, daily and monthly budgets — checked and debited atomically. |
| **Tools** (`/authorize/tool`) | Block/allow/escalate lists for any MCP tool or external action. Escalations reach the approval inbox like spend does. |
| **Credentials** (`/exec` + `/credentials/inject`) | AES-256-GCM envelope-encrypted vault (KMS-wrapped, rotating keys). Injection requires a scoped 15-minute execution JWT and clearance ≥ the credential's bar. Every access audit-logged. |
| **Provisioning** (`/authorize/provision`) | Seats, licenses, infrastructure — resource, line item, quantity, and dollars authorized in one call. |

Around the engine:

- **Human approvals → one-use grants.** Escalations land in an approval inbox
  (dashboard PWA, email, Slack). Approving mints a single-use, expiring grant
  the agent redeems on retry. Policy timeouts guarantee a terminal outcome.
- **Seats.** An agent is a seat you can hand to whoever holds it: named
  holders, contractor auto-expiry (the key fails closed past the date), key
  rotation that keeps history, and batch creation from one template.
- **Budgets that cascade.** Wallets nest into trees; subtree caps are enforced
  atomically so sibling agents can't race past a parent's limit. The dashboard
  leads with budget runway — % used, pace, exhaust ETA — from wallet down to seat.
- **Notifications that find you.** Email by default; Slack with one pasted
  webhook URL (readable messages, Review button); signed JSON webhooks for
  machines — each route subscribed to its own events. [Guide](docs/NOTIFICATIONS.md)
- **The audit plane.** `GET /audit-events` merges every decision, token log,
  and secret access into one feed; `GET /reporting/daily-summary` is the
  one-call morning rollup.
- **LLM gateway.** Point your model SDK's base URL at
  `https://getsanction.com/api/gateway/<provider>` with `x-sanction-key` —
  usage is metered and budget-capped with zero per-call instrumentation.

Every security claim above maps to enforcing code and a regression test in
[docs/TRACEABILITY.md](docs/TRACEABILITY.md) — 500+ tests behind an 80%
coverage gate, including concurrency and Postgres row-level-security suites.

---

## Distribution

- **MCP server** — `npx sanction-mcp` in any MCP host (Claude Desktop, etc.)
- **TypeScript SDK** — `@sanction/sdk`: `SanctionClient` (agent plane) and `SanctionAdminClient` (management plane)
- **REST API** — direct integration, OpenAPI 3.0 spec at `/api/openapi.json` (Bedrock-compatible)
- **AWS Bedrock Action Group** — enterprise agent orchestration
- **LLM gateway** — cross-provider metering with no code changes

Guides: [Quickstart](docs/QUICKSTART.md) ·
[Starter kit](docs/STARTER-KIT.md) ·
[LangChain](docs/LANGCHAIN.md) · [CrewAI](docs/CREWAI.md) ·
[Vercel AI SDK](docs/VERCEL-AI-SDK.md) ·
[Multi-tenant runbook](docs/INTEGRATION.md) ·
[Notifications](docs/NOTIFICATIONS.md)

---

## API

Base URL: `https://getsanction.com/api/v1`

```
# Authorization (agent key: x-api-key pxy_...)
POST  /authorize                — Authorize a spend action (grant_id redeems an approval)
POST  /authorize/tool           — Authorize a tool invocation
POST  /authorize/provision      — Authorize provisioning (resource + line item + $)
GET   /authorize/{id}           — Poll an escalated decision (grant receipt included)
POST  /tokens                   — Log LLM token consumption against the daily budget
POST  /exec                     — Issue a scoped execution JWT (15-min TTL)
POST  /credentials/inject       — Inject a decrypted credential (Bearer JWT)
GET   /audit-events             — Unified audit feed (decisions, tokens, secret access)
GET   /reporting/daily-summary  — One-day rollup

# Management (owner key: x-mgmt-key sk_...)
POST  /wallets                  — Create a wallet + policy (management key shown once)
GET   /wallets/stats            — Today + month-to-date stats
GET   /wallets/tree             — Subtree spend rollup
GET/PATCH /wallets/policy       — Read / update budgets, thresholds, lists
POST  /wallets/keys/rotate      — Rotate the wallet's data-encryption key
POST  /agents                   — Register a seat (holder, expiry; key shown once)
POST  /agents/batch             — Stamp one template across up to 50 seats
GET/PATCH /agents               — List / per-seat budgets, clearance, holder, expiry
POST  /agents/rotate            — Rotate a seat's key (optionally pass to a new holder)
POST  /credentials/vault        — Store an encrypted credential
POST  /exec/revoke              — Kill a live execution token
GET/POST /approvals             — The approval inbox; approving mints a one-use grant
POST  /webhooks                 — Register a notification route (per-event subscriptions)
```

Full schemas: [`/api/openapi.json`](https://getsanction.com/api/openapi.json).

---

## MCP setup

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

Next.js 16 (App Router) + TypeScript · Prisma 7 on Neon Postgres (row-level
security enforced at the database) · Vercel · jose (HS256, alg-pinned) ·
AES-256-GCM envelope encryption with AWS KMS root of trust in production.

## Contributing & security

[CONTRIBUTING.md](CONTRIBUTING.md) gets you from clone to green PR
(`npm install && npm run check` — no database needed for unit tests).
Security model and disclosure: [docs/SECURITY.md](docs/SECURITY.md).
Vocabulary: [docs/DOMAIN.md](docs/DOMAIN.md).

## Pricing

**Free** for individuals — no card, personal and production use.
**Enterprise** — paid license: SSO, policy administration, audit export, SLA,
deployment control. [Talk to us](https://getsanction.com/#pricing).

## License

- **`packages/sanction-mcp`** (the MCP client) — [MIT](packages/sanction-mcp/LICENSE). Embed it anywhere.
- **Everything else** (server, dashboard, API) — [Functional Source License 1.1](LICENSE) (FSL-1.1-MIT). Source-available: use and self-host for any purpose except offering a competing service. Converts to MIT two years after release.
