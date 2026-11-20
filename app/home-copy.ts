// Homepage copy that is expected to change without a layout change.
//
// POSITIONING picks the hero. The other heroes are the alternatives that were
// reviewed alongside it; switching is this one word.
export type Positioning = "inbox" | "exact" | "layer"

export const POSITIONING: Positioning = "inbox"

export const HEROES: Record<Positioning, { headline: string; lead: string }> = {
  inbox: {
    headline: "One approval inbox for every AI agent you use.",
    lead: "Connect Claude, Cursor, Codex, Grok or your own app. When an agent reaches a step that needs you, it asks. You approve or reject that exact action in Sanction, or in Slack when connected, and it resumes with a one-use permission.",
  },
  exact: {
    headline: "Approve the exact action, not the agent.",
    lead: "A yes in Sanction covers one request with its exact inputs, once. If the agent changes the request or tries the approval twice, it is refused.",
  },
  layer: {
    headline: "The authorization layer for AI agents.",
    lead: "Policy, approvals, budgets and a decision record, resolved together before an agent spends, calls a tool or touches a credential.",
  },
}

// "verified" means the surface works end to end today: a recorded host run
// (request, human decision, redemption) or, for Slack and the API, a shipped
// path covered by the repo's tests. "partial" and "pending" say what has not
// been recorded yet. docs/CONNECT.md holds the dated evidence, and
// tests/home-page.test.tsx fails if a host is "verified" here while the guide
// still calls its lifecycle pending.
export type HostTone = "verified" | "partial" | "pending"

export const HOSTS: { name: string; status: string; tone: HostTone }[] = [
  { name: "Claude", status: "Full approval loop verified", tone: "verified" },
  { name: "Slack", status: "Approve or deny from a channel", tone: "verified" },
  { name: "Grok", status: "Sign-in and status tested", tone: "partial" },
  { name: "Codex", status: "Full loop test pending", tone: "pending" },
  { name: "Cursor", status: "Full loop test pending", tone: "pending" },
  { name: "Your own app", status: "REST API and MCP server", tone: "verified" },
]
