// Curated public roadmap. Hand-picked Now / Next / Later — you control exactly
// what's exposed. Security-gate work (envelope encryption, tenant isolation, key
// rotation) is intentionally NOT listed here; keep the gate private until it
// ships, then announce it in the changelog. Edit freely — this is the public face
// of the backlog, not a live mirror of it.
//
// Principle: the roadmap leads the product by ~one release, never lags it. "Now"
// is what's shipped/shipping; "Next" leads by one release; "Later" is the arc.
// The arc reads: the engine, approvals→grants, seats, standards (AuthZEN/AARP),
// evidence+replay, and capability governance are shipped (see the changelog) →
// now, simulation + teaching the architecture → next, sequential replay + local
// deployment + policy packs → later, cryptographic audit + enterprise trust.

export type RoadmapItem = { title: string; note: string }

export const ROADMAP: { now: RoadmapItem[]; next: RoadmapItem[]; later: RoadmapItem[] } = {
  now: [
    { title: "What-if, answered from history", note: "Replay your real decisions under a candidate policy before you set it — see exactly which calls would flip, what spend wouldn't clear, and why. The same engine that made the original calls, pointed backward." },
    { title: "The architecture, taught", note: "How Sanction Works, Why Sanction, and a Concepts library — the mental model before the quickstart: identity stays upstream, one atomic decision, evidence you can replay." },
    { title: "Capability governance", note: "Installing a skill, adding a plugin, calling a new API — new capability is a governed action like spending money. One rule list: allow, escalate, or deny before new power lands in an agent." },
    { title: "Reporting that looks both ways", note: "Period summaries and per-seat rollups behind you; burn-pace projections and exhaustion forecasts ahead; a Monday digest in your Slack; CSV for finance." },
  ],
  next: [
    { title: "Sequential simulation", note: "Today's what-if holds recorded state constant; next it replays the week in order — an early simulated denial frees budget for the request that came after, exactly as it would have lived." },
    { title: "Sanction Local", note: "Private AI on hardware you own — local models, zero egress by design, and a signed audit trail your assessor can read. Regulated practices first." },
    { title: "Policy packs", note: "Installable starting policies — startup defaults, compliance baselines, per-team packs — each shipped with a simulation of what it would have done to your last 30 days." },
    { title: "Budget reallocation", note: "Move unused budget across the account tree to where it's needed — leftover tokens become working capital, and the reallocation shows up in the audit." },
  ],
  later: [
    { title: "Tamper-evident audit exports", note: "Hash-chained, exportable decision history — governance as cryptographic evidence." },
    { title: "Customer-managed keys + SOC 2", note: "Bring-your-own encryption keys and the compliance attestations enterprises require." },
    { title: "Mandate authority (AP2 / x402)", note: "Hold the mandate, not the rail — policy, consent, and audit in front of whichever agent-payment standard wins." },
  ],
}
