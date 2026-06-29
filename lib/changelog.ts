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
