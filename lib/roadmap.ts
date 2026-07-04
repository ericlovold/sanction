// Curated public roadmap. Hand-picked Now / Next / Later — you control exactly
// what's exposed. Security-gate work (envelope encryption, tenant isolation, key
// rotation) is intentionally NOT listed here; keep the gate private until it
// ships, then announce it in the changelog. Edit freely — this is the public face
// of the backlog, not a live mirror of it.
//
// Principle: the roadmap leads the product by ~one release, never lags it. "Now"
// is what's shipped/shipping; "Next" leads by one release; "Later" is the arc.
// The arc reads: the engine, approvals→grants, provisioning, pools, the audit
// plane, and the SDK are shipped (see the changelog) → now, approvals anywhere +
// seats you can hand around → next, local deployment + plain-English policy →
// later, cryptographic audit + enterprise trust.

export type RoadmapItem = { title: string; note: string }

export const ROADMAP: { now: RoadmapItem[]; next: RoadmapItem[]; later: RoadmapItem[] } = {
  now: [
    { title: "Speak the standards (AuthZEN)", note: "Sanction as an OpenID AuthZEN decision point — any standards-speaking gateway can ask before its agent acts, and the escalate → approve → grant loop rides the draft approval profile." },
    { title: "Approvals that find you", note: "Escalations routed to the right human wherever they work — email today, Slack and webhooks next." },
    { title: "Seat wallets", note: "A wallet per seat you can hand to whoever holds it — rotate on attrition, auto-expire contractors, stamp a team template across five seats at once. Budgets by team, by day, by seat." },
  ],
  next: [
    { title: "Skill-install governance", note: "Installing a skill or tool is a governed action like spending money — allow, escalate, or deny before new capability lands in an agent." },
    { title: "Sanction Local", note: "Private AI on hardware you own — local models, zero egress by design, and a signed audit trail your assessor can read. Regulated practices first." },
    { title: "Policy templates & plain-English governance", note: "Start from sensible presets; read and write your guardrails in words, not cents." },
    { title: "Budget reallocation", note: "Move unused budget across the account tree to where it's needed — leftover tokens become working capital, and the reallocation shows up in the audit." },
  ],
  later: [
    { title: "Tamper-evident audit exports", note: "Hash-chained, exportable decision history — governance as cryptographic evidence." },
    { title: "Customer-managed keys + SOC 2", note: "Bring-your-own encryption keys and the compliance attestations enterprises require." },
    { title: "Mandate authority (AP2 / x402)", note: "Hold the mandate, not the rail — policy, consent, and audit in front of whichever agent-payment standard wins." },
  ],
}
