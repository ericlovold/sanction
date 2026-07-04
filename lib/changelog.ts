// Build-in-public changelog. Add a new entry to the TOP of the array to publish.
// `body` is markdown (rendered with the shared <Markdown> component). Keep dates
// ISO (YYYY-MM-DD). `version` is optional — use it when a release is tagged.
//
// NOTE: seed dates/versions below are approximate — adjust to your actual release
// dates as you go. New entries on top.

export type ChangelogEntry = {
  date: string
  title: string
  version?: string
  tags?: string[]
  body: string
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-07-04",
    title: "Approvals that find you — Slack, natively",
    tags: ["approvals", "notifications", "slack"],
    body: `Paste a Slack incoming-webhook URL into notification routes and escalations arrive as readable messages, not raw JSON:

- **Approvals** land as "*tenet* needs approval for *$60.00* — Vendor" with a **Review in Sanction** button.
- **Budget warnings** read "*tenet* has used *84%* of its daily spend" — same 80% line as the dashboard meters and emails.
- **Resolutions and exhaustions** report themselves too. Machine consumers are untouched: non-Slack endpoints keep the HMAC-signed raw payload.

No Slack app to install, no OAuth — the incoming-webhook URL is the whole setup, and Sanction detects it automatically.`,
  },
  {
    date: "2026-07-03",
    title: "Seat wallets, slice 1 — seats you can hand around",
    tags: ["seats", "agents", "management"],
    body: `An agent is now a **seat**: a keyed identity with budgets you can hand to whoever holds it.

- **Contractor auto-shutoff** — set \`expires_at\` on any agent and its key fails closed past that instant, on the data plane and the LLM gateway both. No deactivation step to forget.
- **Holders** — every seat can carry the name of the human holding it, for the audit trail and the dashboard. Rotating a key accepts a new \`holder\` in the same motion: the person changes, the seat's history, budgets, and clearance stay.
- **Batch seats** — \`POST /v1/agents/batch\` stamps one template across up to 50 seats in one call: "five engineering seats, $20/day each, clearance 2, expiring end of quarter." Each key is shown once; only hashes are stored.

Slice 2 (seat-history semantics on reassignment, per-provider budgets within a seat) is being shaped with our design partner. Roadmap: seat wallets stays in **Now** until the full story ships.`,
  },
  {
    date: "2026-07-03",
    title: "Tool escalations reach the inbox — govern any action closes the loop",
    tags: ["authorization", "tools", "grants"],
    body: `Tool governance was decision-only: an escalated tool call answered \`escalated\` and then evaporated. Now it completes the same loop as spend and provision:

- **Escalations persist** — an escalated \`POST /v1/authorize/tool\` writes an audit row and lands in the owner's approval inbox alongside spend and provision requests, with webhook + email notification.
- **Approval mints a one-use tool grant** — redeem it by retrying the same tool (and server) with \`grant_id\`, or poll \`/v1/authorize/{id}\`. Consumption is atomic and one-use; a mismatched tool gets \`GRANT_MISMATCH\`, a replayed grant gets \`GRANT_ALREADY_USED\`.
- **Idempotency-Key on tool calls** — replaying the key returns the escalation's current state, including the terminal decision once the owner resolves it, so a re-POST doubles as a status check.
- **sanction-mcp** \`sanction_authorize_tool\` gains \`grant_id\`, and \`/api/openapi.json\` now documents the endpoint.

Proven end-to-end against real Postgres: escalate → inbox approval → grant minted → redeem on retry → second redemption refused. The full trace is in [docs/TRACEABILITY.md](https://github.com/ericlovold/sanction/blob/main/docs/TRACEABILITY.md).`,
  },
  {
    date: "2026-07-03",
    title: "The audit plane arrives — unified feed, daily summary, monthly caps, and a TypeScript SDK",
    tags: ["audit", "budgets", "sdk", "dashboard"],
    body: `Yesterday the authorization plane grew muscles; today it grew a memory and a voice:

- **Unified audit feed** — \`GET /v1/audit-events\` merges every spend decision, token log, and credential injection into one time-sorted feed with type filters and cursor pagination. The "what did my agents do?" endpoint.
- **Daily summary** — \`GET /v1/reporting/daily-summary\`: one call returns the day's spend, decision counts, token cost, secret accesses, and the five most expensive tasks. The screen you check before coffee.
- **Monthly spend caps** — policies can now set an opt-in \`monthly_spend_budget_usd\` alongside the daily cap, enforced atomically on **both** spend and provision (a provision is spend — no side doors). New \`MONTHLY_BUDGET_EXCEEDED\` decision code with a remediation hint.
- **@sanction/sdk** — a zero-dependency TypeScript SDK for both planes: \`SanctionClient\` (authorize, log tokens, scoped credential injection) and \`SanctionAdminClient\` (wallets, agents, policy). A \`denied\` decision is *returned, not thrown* — agents branch and replan.
- **Runnable starter kit** — \`examples/nightly-coding-agent\` demonstrates the whole governed-autonomy loop offline against a deterministic mock, plus copyable policy blueprints for coding and research agents.
- **Console shell** — the dashboard is now one console: a persistent sidebar with a live pending-approvals badge across Overview, Agents, Pools, Spend, Approvals, and Grants.
- **Red-team CI gate** — five adversarial guardrail probes (over-limit spend, blocked category, over-clearance credential, out-of-scope injection, exec-budget breach) now run on every push. The suite passing *is* the "5/5 guardrails held" scorecard.

Next on the [roadmap](/roadmap): Sanction Local, and a local-first SDK fallback for when the network isn't there.`,
  },
  {
    date: "2026-07-02",
    title: "Provision authorization, no-surprises alerts, DB-level tenant isolation — and sanction-mcp 0.3.0",
    version: "v0.3.0",
    tags: ["release", "security", "authorization"],
    body: `The biggest shipping day since going public — the authorization plane grew three new muscles:

- **Provision authorization** — govern resource provisioning as one native call: \`POST /v1/authorize/provision\` takes resource + line item + quantity + dollars, runs the same policy ladder and daily budget as spend, and adds resource allow/block/escalate lists. Escalations mint one-use grants; retry with the grant to proceed.
- **No-surprises budget alerts** — a new \`budget.threshold\` webhook + heads-up email fires exactly once when a charge crosses 80% of any daily budget or pool cap — *before* anything is denied. Dashboards now project the burn: "on pace for $86 today · cap hit ~4:12 PM."
- **Budget pools + allocation** — delegated pools across your account tree, with allocation strategies to rebalance a parent cap across child pools from the dashboard.
- **Postgres row-level security** — the credential vault and clearance tables are now tenant-isolated *at the database level*, fail-closed, on top of the KMS envelope encryption already at rest. A SQL bug can't read another tenant's rows; a DB dump can't be decrypted.
- **sanction-mcp 0.3.0** ([npm](https://www.npmjs.com/package/sanction-mcp)) — the MCP server catches up to all of it: a new \`sanction_authorize_provision\` tool, \`grant_id\` retries on authorize, and hardened transport (network failures now degrade to a clear deny, never an ambiguous error).

The [roadmap](/roadmap) moved with it: approval→grants, provision, pools, and threshold alerts are all *Now*; next up — Sanction Local and the agent-platform starter kit.`,
  },
  {
    date: "2026-07-01",
    title: "Human approvals now issue grants",
    tags: ["approvals", "wallets"],
    body: `Sanction's approval loop now has a durable authorization record:

- **Generic approvals** — spend escalations now land as \`PendingApproval\` rows that can also support tool and credential workflows.
- **Grants ledger** — owner approval issues a short-lived \`Grant\` with provenance: who approved it, what agent received it, what resource it covers, and why.
- **Opt-in subtree caps** — parent wallets can set \`subtree_daily_cap_usd\` to enforce a tree-wide daily spend cap across descendants. Leaving it null keeps subtree enforcement disabled while spend rollups remain visible.`,
  },
  {
    date: "2026-06-29",
    title: "v0.2.0 — framework guides, public roadmap, clearer positioning",
    version: "v0.2.0",
    tags: ["release"],
    body: `Our first feature release since going public:

- **Framework guides** — drop Sanction into your agent in minutes: [Quickstart](/docs/quickstart), [Vercel AI SDK](/docs/ai-sdk), [LangChain](/docs/langchain), [CrewAI](/docs/crewai).
- **Public roadmap + changelog + idea board** — [tell us what to build next](/roadmap) and vote on it.
- **Account tree** — govern many agents under one master account, with per-tenant budgets and subtree spend rollup.
- **Clearer positioning** — Sanction is the authorization layer for AI agents, with an honest integrations story.`,
  },
  {
    date: "2026-06-28",
    title: "Building Sanction in the open",
    tags: ["product"],
    body: `We're now shipping our roadmap and release notes in public. Every
product update lands here, and you can [tell us what to build next](/roadmap) —
submit ideas, vote, and watch them move from *under consideration* to *shipped*.

Subscribe below and we'll send updates as they ship. No spam.`,
  },
  {
    date: "2026-06-25",
    title: "Account tree — govern a fleet under one master account",
    tags: ["wallets", "platform"],
    body: `Wallets can now nest into an org → tenant → sub-tenant hierarchy.
Provision one agent per tenant, set per-tenant budgets, and roll spend up the
tree for chargeback — all from a single account.`,
  },
  {
    date: "2026-06-20",
    title: "Gateway metering across providers + escalation timeouts",
    tags: ["gateway", "policy"],
    body: `Route Anthropic, OpenAI, and Gemini through one gateway and one key —
every token metered and capped in one place. Plus: an escalated request that no
human resolves now settles to a fail-closed fallback, so a polling agent never
deadlocks.`,
  },
  {
    date: "2026-06-15",
    title: "Authenticated management plane + atomic spend",
    version: "Security gate · PR #1",
    tags: ["security"],
    body: `Closed a credential-disclosure path: the management plane now requires
an owner key on every call. Spend authorization is atomic and idempotent — a
retry can't double-spend, and two concurrent requests can't both slip past the
daily cap.`,
  },
]
