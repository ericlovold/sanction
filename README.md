# Sanction

**The independent authorization plane for AI agents.**

Before an agent spends money, invokes a tool, touches a credential, or
provisions a resource, it asks Sanction. Sanction approves, escalates to a
human, or denies. Every decision is logged and auditable. Sanction belongs to
no platform: one policy engine answers across model providers, payment rails,
identities, and agent ecosystems.

---

## What it does

One policy decision engine governs every kind of agent action:

| Governed action | What Sanction enforces |
|---|---|
| **Spend** (`/authorize`) | Auto-approve floor, human-escalation band, per-transaction hard cap, daily and monthly budgets — checked and debited atomically. |
| **Tools** (`/authorize/tool`) | Block/allow/escalate lists for any MCP tool or external action. Escalations reach the approval inbox like spend does. |
| **Credentials** (`/exec` + `/credentials/inject`) | AES-256-GCM envelope-encrypted vault (KMS-wrapped, rotating keys). Injection requires a scoped 15-minute execution JWT and clearance ≥ the credential's bar. Every access audit-logged. |
| **Provisioning** (`/authorize/provision`) | Seats, licenses, infrastructure — resource, line item, quantity, and dollars authorized in one call. |
| **Capability** (`/authorize/capability`) | Skills, plugins, new APIs — acquiring capability is governed like spending money. One ordered rule list (block / allow / escalate, prefix-glob patterns) gates new power before it lands in an agent. |

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
- **Evidence you can replay.** Every policy edit becomes an immutable
  revision; every decision stores the revision in force and the exact context
  the engine evaluated. `GET /authorize/{id}/evidence` re-runs the pure rules
  over the stored context and proves the outcome reproduces.
- **What-if over real history.** `POST /policy/simulate` replays stored
  decisions under a candidate policy — which calls flip, what spend wouldn't
  clear — before you change anything.
- **The audit plane.** `GET /audit-events` merges every decision, token log,
  and secret access into one feed (CSV export included);
  `GET /reporting/summary` spans any period with day buckets and per-seat
  rollups; wallet stats project burn pace and exhaustion ETAs; a weekly
  digest lands in Slack every Monday.
- **LLM gateway.** Point your model SDK's base URL at
  `https://getsanction.com/api/gateway/<provider>` with `x-sanction-key` —
  usage is metered and budget-capped with zero per-call instrumentation.

Every security claim above maps to enforcing code and a regression test in
[docs/TRACEABILITY.md](docs/TRACEABILITY.md) — 600+ tests behind an 80%
coverage gate, including concurrency and Postgres row-level-security suites.

---

## Distribution

Platform vendors govern agents inside their own walls. Sanction authorizes
agents wherever they run:

- **MCP server** — `npx sanction-mcp` in any MCP host (Claude Desktop, etc.)
- **AuthZEN PDP** — any [OpenID AuthZEN 1.0](https://openid.net/specs/authorization-api-1_0.html) enforcement point can use Sanction as its decision point, zero custom code ([guide](docs/AUTHZEN.md))
- **TypeScript SDK** — `@sanction/sdk`: `SanctionClient` (agent plane) and `SanctionAdminClient` (management plane)
- **REST API** — direct integration, OpenAPI 3.0 spec at `/api/openapi.json` (Bedrock-compatible)
- **AWS Bedrock Action Group** — enterprise agent orchestration ([setup guide](docs/BEDROCK.md))
- **LLM gateway** — cross-provider metering with no code changes

Guides: [Quickstart](docs/QUICKSTART.md) ·
[Starter kit](docs/STARTER-KIT.md) ·
[LangChain](docs/LANGCHAIN.md) · [CrewAI](docs/CREWAI.md) ·
[Vercel AI SDK](docs/VERCEL-AI-SDK.md) ·
[Bedrock Agents](docs/BEDROCK.md) ·
[Agent fleets](docs/AGENT-FLEETS.md) ·
[AuthZEN PDP](docs/AUTHZEN.md) ·
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
POST  /authorize/capability     — Authorize acquiring capability (skill/plugin/API)
GET   /authorize/{id}           — Poll an escalated decision (grant receipt included)
GET   /authorize/{id}/evidence  — Replay a decision over its stored context (match verdict)
POST  /tokens                   — Log LLM token consumption against the daily budget
POST  /exec                     — Issue a scoped execution JWT (15-min TTL)
POST  /credentials/inject       — Inject a decrypted credential (Bearer JWT)
GET   /audit-events             — Unified audit feed (decisions, tokens, secret access; ?format=csv)
GET   /reporting/summary        — Any range ≤92 days: totals, day buckets, per-agent
GET   /reporting/daily-summary  — One-day rollup

# AuthZEN PDP + AARP (agent key; base https://getsanction.com/api — spec-canonical paths)
POST  /access/v1/evaluation     — OpenID AuthZEN 1.0 evaluation (decision-only)
POST  /access/v1/evaluations    — AuthZEN batch, all three evaluation semantics
POST  /access/v1/access-request — AARP: open an escalation from a signed binding token
GET   /access/v1/access-request/{id} — AARP task status (maps to the profile's states)

# Management (owner key: x-mgmt-key sk_...)
POST  /wallets                  — Create a wallet + policy (management key shown once)
GET   /wallets/stats            — Today + month-to-date stats + burn projections
GET   /wallets/tree             — Subtree spend rollup
GET/PATCH /wallets/policy       — Read / update budgets, thresholds, lists, capability rules
POST  /policy/simulate          — Replay real history under a candidate policy (what-if)
GET   /policy/packs             — List installable policy packs (public)
POST  /policy/packs/{id}/preview — Simulate a pack against your last 30 days
POST  /policy/packs/{id}/apply  — Install a pack as the wallet policy (writes a revision)
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

It's free, or it's an agreement. **Free** for individuals — no card, personal
and production use. Beyond that, an enterprise agreement shaped to your
deployment: SSO, policy administration, audit export, SLA.
[Talk to us](https://getsanction.com/#pricing).

## License

- **`packages/sanction-mcp`** (the MCP client) — [MIT](packages/sanction-mcp/LICENSE). Embed it anywhere.
- **Everything else** (server, dashboard, API) — [Functional Source License 1.1](LICENSE) (FSL-1.1-MIT). Source-available: use and self-host for any purpose except offering a competing service. Converts to MIT two years after release.
- **Commercial use beyond the FSL** — [Commercial License guide](docs/COMMERCIAL-LICENSE.md) ([on-site](https://getsanction.com/docs/commercial-license)).
