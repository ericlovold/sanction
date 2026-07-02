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
