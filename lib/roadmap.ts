// Curated public roadmap. Hand-picked Now / Next / Later — you control exactly
// what's exposed. Security-gate work (envelope encryption, tenant isolation, key
// rotation) is intentionally NOT listed here; keep the gate private until it
// ships, then announce it in the changelog. Edit freely — this is the public face
// of the backlog, not a live mirror of it.
//
// Principle: the roadmap leads the product by ~one release, never lags it. "Now"
// is what's shipped/shipping; "Next" leads by one release; "Later" is the arc.
// The arc reads: today govern spend AND tool actions through one engine → next,
// human approval + local deployment → later, cryptographic audit + enterprise trust.

export type RoadmapItem = { title: string; note: string }

export const ROADMAP: { now: RoadmapItem[]; next: RoadmapItem[]; later: RoadmapItem[] } = {
  now: [
    { title: "Policy simulation", note: "Validate your policy end-to-end before any real money or action flows." },
    { title: "Policy decision engine", note: "One engine evaluates every request — structured allow / deny / escalate with a machine-readable code and fix hint." },
    { title: "Govern any MCP tool", note: "Approve, deny, or escalate any tool invocation — not just spending. Authorization for agent actions, not just money." },
    { title: "Org-wide spend budgets", note: "Budgets enforced across your whole account tree — caps cascade down, spend rolls up." },
    { title: "MCP registry listing", note: "First-class discovery so any MCP host can add Sanction in one step." },
  ],
  next: [
    { title: "Human approval workflows", note: "Owner-in-the-loop approval for escalated spend and tool actions, with a guaranteed terminal outcome — no deadlocks." },
    { title: "Policy templates & plain-English governance", note: "Start from sensible presets; read and write your guardrails in words, not cents." },
    { title: "Activity & decisions dashboard", note: "Spend, credentials, LLM usage, tools, and approvals — every decision in a single view." },
    { title: "Sanction Local", note: "Run governed AI entirely on your own infrastructure — the same policy engine and audit trail, on-prem." },
  ],
  later: [
    { title: "Tamper-evident audit exports", note: "Hash-chained, exportable decision history — governance as cryptographic evidence." },
    { title: "Customer-managed keys + SOC 2", note: "Bring-your-own encryption keys and the compliance attestations enterprises require." },
    { title: "Payment-rail neutrality (AP2 / x402)", note: "Be the policy + consent + audit layer in front of whichever agent-payment rail wins." },
  ],
}
