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
    { title: "Policy decision engine", note: "One engine evaluates every request — structured allow / deny / escalate with a machine-readable code and fix hint." },
    { title: "Human approval → one-use grants", note: "Escalations land in your approval inbox; approving mints a one-use grant the agent retries with. Policy timeouts guarantee a terminal outcome — no deadlocks." },
    { title: "Provision authorization", note: "Govern resource provisioning — seats, licenses, infrastructure — quantity, line item, and dollars in one authorized call." },
    { title: "Budget pools & allocation", note: "Delegated pools across your account tree — caps cascade down, spend rolls up, and allocation strategies rebalance from the dashboard." },
    { title: "No-surprises budget alerts", note: "Early warning at 80% of any daily budget or pool cap — webhook + email before anything is denied, with burn-rate projections on every meter." },
    { title: "Govern any MCP tool", note: "Approve, deny, or escalate any tool invocation — not just spending. Authorization for agent actions, not just money." },
  ],
  next: [
    { title: "Sanction Local", note: "Private AI on hardware you own — local models, zero egress by design, and a signed audit trail your assessor can read. Regulated practices first." },
    { title: "Agent-platform starter kit", note: "One recipe for any agent builder: before spend, tools, credentials, or provisioning, call Sanction — escalations wait for a human grant." },
    { title: "Approvals that find you", note: "Escalations routed to the right human wherever they work — email today, Slack and webhooks next." },
    { title: "Policy templates & plain-English governance", note: "Start from sensible presets; read and write your guardrails in words, not cents." },
  ],
  later: [
    { title: "Tamper-evident audit exports", note: "Hash-chained, exportable decision history — governance as cryptographic evidence." },
    { title: "Customer-managed keys + SOC 2", note: "Bring-your-own encryption keys and the compliance attestations enterprises require." },
    { title: "Payment-rail neutrality (AP2 / x402)", note: "Be the policy + consent + audit layer in front of whichever agent-payment rail wins." },
  ],
}
