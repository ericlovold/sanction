# Sanction

**The independent authorization plane for AI agents.**

Before an agent spends money, invokes a tool, touches a credential, or
provisions a resource, it asks Sanction. Sanction approves, escalates to a
human, or denies. Every decision is logged and auditable. Sanction belongs to
no platform: one policy engine answers across model providers, payment rails,
identities, and agent ecosystems.

## Who runs Sanction

- **Organizations governing their own AI** — the primary case. Teams and
  departments become wallets in a tree; budgets, tool rules, and approval
  bands are enforced — not dashboarded — with chargeback-ready reporting
  underneath. Alerts tell you what happened; a decision happens first.
- **Platforms and agencies embedding governance** — agents you ship or run
  for clients carry a wallet wherever they execute: MCP hosts, Bedrock,
  your own stack via SDK or REST.
- **Individuals** — free, no card, personal and production use.

---

## What it does

One policy decision engine governs every kind of agent action:

| Governed action | What Sanction enforces |
|---|---|
| **Spend** (`/authorize`) | Auto-approve floor, human-escalation band, per-transaction hard cap, daily and monthly budgets — checked and debited atomically. |
| **Tools** (`/authorize/tool`) | Block/allow/escalate lists for any MCP tool or external action. Escalations reach the approval inbox like spend does. |
| **Credentials** (`/exec` + `/mandate/verify` + `/credentials/inject`) | AES-256-GCM envelope-encrypted vault (KMS-wrapped, rotating keys). Injection requires a scoped 15-minute mandate JWT and clearance ≥ the credential's bar. Counterparties verify the mandate with no API key. Every access audit-logged. |
| **Provisioning** (`/authorize/provision`) | Seats, licenses, infrastructure — resource, line item, quantity, and dollars authorized in one call. |
| **Capability** (`/authorize/capability`) | Skills, plugins, new APIs — acquiring capability is governed like spending money. One ordered rule list (block / allow / escalate, prefix-glob patterns) gates new power before it lands in an agent. |

What a decision looks like in practice — one `POST /authorize` with an
amount, three possible outcomes, all of them terminal or resumable:

- **Approved** → `{ "status": "approved" }`; budget counters debit in the
  same transaction the decision persists (an advisory lock makes sibling
  agents queue, not race).
- **Escalated** → `{ "status": "escalated", "request_id": "…" }`; a human
  sees it in the approval inbox, and approving mints a one-use grant the
  agent redeems by retrying with `grant_id`. Policy decides what a timeout
  means (approve or deny) — nothing hangs forever.
- **Denied** → `{ "status": "denied", "decision_code": "PER_TXN_LIMIT",
  "remediation": "Amount exceeds the per-transaction limit. Split into
  smaller charges or ask the owner to raise the limit." }`. Codes are
  stable machine strings (`DAILY_BUDGET_EXCEEDED`,
  `CATEGORY_BLOCKED`, `WALLET_FROZEN`, …) so agents branch and replan
  instead of parsing prose. Replays of the same request return the same code.

Around the engine:

- **Human approvals → one-use grants.** Escalations land in an approval inbox
  (dashboard PWA, email, Slack). Approving mints a single-use, expiring grant
  the agent redeems on retry. Policy timeouts guarantee a terminal outcome.
- **Seats.** An agent is a seat you can hand to whoever holds it: named
  holders, contractor auto-expiry (the key fails closed past the date), key
  rotation that keeps history, and batch creation from one template.
- **Budgets that cascade.** Wallets nest into trees; subtree caps are enforced
  atomically so sibling agents can't race past a parent's limit. The console's
  spend view draws the month's runway — cumulative burn against the cap, pace,
  and the projected exhaust date — from wallet down to seat.
- **Notifications that find you.** Email by default; signed JSON webhooks for
  machines; and Slack two ways — a pasted incoming-webhook URL that deep-links
  to the decision, or **Add to Slack**, which installs per workspace over OAuth
  and posts interactive **Approve / Deny** buttons that run the same
  `resolveApproval` path as the dashboard, actor recorded. Each route subscribes
  to its own events. [Guide](docs/NOTIFICATIONS.md)
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
- **Tamper-evident exports.** `GET /audit/export` hands you a signed,
  hash-chained snapshot of your governed decisions: altering, dropping, or
  reordering any row breaks the chain, and the head is HMAC-signed by Sanction.
  A regulator or the governed customer runs `POST /audit/verify` — self-contained,
  no database — to prove nothing changed after signing, down to the first broken link.
- **A console that opens on the roster.** The dashboard home is the wallet tree
  as groups with agents as cards, each carrying a mandate stamp (live / paused /
  blocked). A wallet holds people, not just keys: team membership with roles
  (`owner` / `admin` / `viewer`), a switcher across every membership, and a
  viewer who can read everything and change nothing.
- **Adopt without enforcing.** Observe mode runs the real engine on a live fleet
  and records what it *would* have done — blocking nothing, moving no counters —
  so you can watch a week of would-be denials and the dollars behind them, then
  flip each pool to enforce in one confirm-gated click.
- **Spend answerable to outcomes.** Report outcomes (`POST /outcomes`) and a
  wallet over its cost-per-outcome ceiling throttles to human-gated spend.
  Wallets can be frozen outright, and budget reallocated across the tree.
- **LLM gateway.** Point your model SDK's base URL at
  `https://getsanction.com/api/gateway/<provider>` with `x-sanction-key` —
  usage is metered and budget-capped with zero per-call instrumentation.

Every security claim above maps to enforcing code and a regression test in
[docs/TRACEABILITY.md](docs/TRACEABILITY.md) — 1,100+ tests behind a coverage
gate of 90% statements/lines, 94% functions, and 83% branches, including
concurrency and Postgres row-level-security suites.

### Start from a pack, not a blank policy

Eleven installable policy packs cover the common shapes — **Startup defaults**,
**Coding agent seat**, **MCP tool governance**, **Compliance baseline**,
**Client-safe launch**, and **No-egress** (Sanction Local) among them. `GET /policy/packs` lists them;
`POST /policy/packs/{id}/preview` simulates one against your last 30 days of
real decisions before anything changes; `apply` writes it as a policy revision.

### Changing policy in production

Policy edits are never a leap of faith:

1. Draft the change (or pick a pack).
2. `POST /policy/simulate` replays your stored decision history under the
   candidate — see exactly which calls flip and what spend wouldn't clear.
3. Apply. The edit becomes an immutable revision; every subsequent decision
   records the revision in force.
4. If a decision is ever questioned, `GET /authorize/{id}/evidence` re-runs
   the rules over the stored context and proves the outcome reproduces.

### When to use the credential vault

Use Sanction's vault when credentials should flow through the same
policy, approval, and audit trail as spend and tools — one clearance model,
no separate secrets cluster. Keep your existing Vault or Secrets Manager
when you need fleet-scale secret lifecycle management independent of agent
governance; Sanction consumes upstream identity and secrets rather than
replacing them. Threat model: [docs/SECURITY.md](docs/SECURITY.md).

---

## Distribution

Platform vendors govern agents inside their own walls. Sanction authorizes
agents wherever they run. Pick the shortest path to your stack:

| You want to… | Use | First step |
|---|---|---|
| Govern any MCP host (Claude Desktop, Cursor, …) | MCP wallet | Paste `https://getsanction.com/mcp` or `npx sanction-mcp` |
| Meter model spend with zero code changes | LLM gateway | Point the SDK base URL at `/api/gateway/<provider>` |
| Govern agents in a TypeScript app | SDK | [`sdk/`](sdk/) in this repo (npm publish pending) |
| Call the engine from anything else | REST API | `POST /v1/authorize` with an `x-api-key` |
| Plug into an AuthZEN enforcement point | PDP | Point it at `/api/access/v1/evaluation` |
| Orchestrate on AWS Bedrock | Action Group | [docs/BEDROCK.md](docs/BEDROCK.md) |

The full menu:

- **MCP (agent wallet)** — paste `https://getsanction.com/mcp` (Streamable HTTP, `x-api-key`) or `npx sanction-mcp` in any MCP host. The agent carries the wallet. [Wallet Card](https://getsanction.com/.well-known/wallet-card.json) · [guide](docs/AGENT-WALLET.md)
- **AuthZEN PDP** — any [OpenID AuthZEN 1.0](https://openid.net/specs/authorization-api-1_0.html) enforcement point can use Sanction as its decision point, zero custom code ([guide](docs/AUTHZEN.md))
- **TypeScript SDK** — [`sdk/`](sdk/) (`@sanction/sdk`, npm publish pending): `SanctionClient` (agent plane) and `SanctionAdminClient` (management plane), plus framework adapters (`SanctionMiddleware`, `sanctionTool`)
- **REST API** — direct integration, OpenAPI 3.0 spec at `/api/openapi.json` (Bedrock-compatible)
- **AWS Bedrock Action Group** — enterprise agent orchestration ([setup guide](docs/BEDROCK.md))
- **LLM gateway** — cross-provider metering with no code changes

Fastest first decision: `bash examples/setup.sh` — wallet, agent, and a demo
policy in one command, printing the env exports your agent needs
([examples/](examples/) has runnable clients to point at it).

[Agent wallet](docs/AGENT-WALLET.md) ·
[Quickstart](docs/QUICKSTART.md) ·
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

Base URL: `https://getsanction.com/api/v1` — grouped by workflow. Agent
endpoints take `x-api-key pxy_…`; management endpoints take the owner's
`x-mgmt-key sk_…`.

**Ask permission** — the data plane an agent calls:

```
POST  /authorize                — Authorize a spend action (grant_id redeems an approval)
POST  /authorize/tool           — Authorize a tool invocation
POST  /authorize/provision      — Authorize provisioning (resource + line item + $)
POST  /authorize/capability     — Authorize acquiring capability (skill/plugin/API)
GET   /authorize/{id}           — Poll an escalated decision (grant receipt included)
POST  /tokens                   — Log LLM token consumption against the daily budget
POST  /outcomes                 — Report an outcome; spend becomes answerable to results
```

**Escalate to a human** — over the line, someone decides:

```
GET/POST /approvals             — The approval inbox; approving mints a one-use grant
```

**Carry credentials** — scoped mandates instead of raw secrets:

```
POST  /exec                     — Mint a scoped mandate JWT (15-min TTL)
POST  /mandate/verify           — Counterparty checks a presented mandate (no API key)
POST  /credentials/inject       — Inject a decrypted credential (Bearer JWT)
POST  /credentials/vault        — Store an encrypted credential (owner)
POST  /exec/revoke              — Kill a live execution token (owner)
```

**Prove what happened** — audit, evidence, reporting:

```
GET   /authorize/{id}/evidence  — Audit proof: re-run the pure rules over the stored
                                  context and confirm the recorded outcome reproduces
GET   /audit-events             — Unified audit feed (decisions, tokens, secret access; ?format=csv)
GET   /reporting/summary        — Any range ≤92 days: totals, day buckets, per-agent
GET   /reporting/daily-summary  — One-day rollup
GET   /audit/export             — Signed, hash-chained decision export (owner; ?download=1)
POST  /audit/verify             — Verify a tamper-evident export (recompute chain + signature)
```

**Shape policy** — edit safely, prove impact first (owner):

```
GET/PATCH /wallets/policy       — Read / update budgets, thresholds, lists, capability rules
POST  /policy/simulate          — Replay real history under a candidate policy (what-if)
GET   /policy/packs             — List installable policy packs (public)
POST  /policy/packs/{id}/preview — Simulate a pack against your last 30 days
POST  /policy/packs/{id}/apply  — Install a pack as the wallet policy (writes a revision)
```

**Run the fleet** — wallets, seats, keys (owner):

```
POST  /wallets                  — Create a wallet + policy (management key shown once)
GET   /wallets/stats            — Today + month-to-date stats + burn projections
GET   /wallets/tree             — Subtree spend rollup
POST  /wallets/keys/rotate      — Rotate the wallet's data-encryption key
POST  /agents                   — Register a seat (holder, expiry; key shown once)
POST  /agents/batch             — Stamp one template across up to 50 seats
GET/PATCH /agents               — List / per-seat budgets, clearance, holder, expiry
POST  /agents/rotate            — Rotate a seat's key (optionally pass to a new holder)
POST  /webhooks                 — Register a notification route (per-event subscriptions)
POST  /wallets/freeze           — Pause every agent action in this wallet and its subtree
POST  /wallets/unfreeze         — Resume exactly where the fleet stopped
POST  /wallets/reallocate       — Move budget across the wallet tree
POST  /wallets/bootstrap-key    — Mint a management key for a legacy wallet
GET   /outcomes                 — Reported outcomes + cost-per-outcome state
GET   /activity                 — Recent decision activity for the console
```

**Speak the standard** — AuthZEN PDP + AARP (agent key; base
`https://getsanction.com/api` — spec-canonical paths):

```
POST  /access/v1/evaluation     — OpenID AuthZEN 1.0 evaluation (decision-only)
POST  /access/v1/evaluations    — AuthZEN batch, all three evaluation semantics
POST  /access/v1/access-request — AARP: open an escalation from a signed binding token
GET   /access/v1/access-request/{id} — AARP task status (maps to the profile's states)
```

Full schemas: [`/api/openapi.json`](https://getsanction.com/api/openapi.json).

---

## MCP setup

The agent carries a Sanction wallet. Discovery: `GET /.well-known/wallet-card.json`.
stdio MCP is cooperative — the host must ask before acting.

```json
{
  "mcpServers": {
    "sanction": {
      "command": "npx",
      "args": ["sanction-mcp"],
      "env": {
        "SANCTION_API_URL": "https://getsanction.com/api/v1",
        "SANCTION_API_KEY": "pxy_..."
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
