// Curated public roadmap. Hand-picked Now / Next / Later — you control exactly
// what's exposed. Security-gate work (envelope encryption, tenant isolation, key
// rotation) is intentionally NOT listed here; keep the gate private until it
// ships, then announce it in the changelog. Edit freely — this is the public face
// of the backlog, not a live mirror of it.
//
// Principle: the roadmap leads the product by ~one release, never lags it. "Now"
// is what's shipped/shipping; "Next" leads by one release; "Later" is the arc.
// The arc reads: the engine, approvals→grants, seats, standards (AuthZEN/AARP),
// evidence+replay, capability governance, simulation, and policy packs are
// shipped (see the changelog) → now, surface them in the console + govern every
// runtime + sequential simulation → next, channel packs + reallocation + local
// deployment → later, cryptographic audit + enterprise trust.

export type RoadmapItem = { title: string; note: string }

export const ROADMAP: { now: RoadmapItem[]; next: RoadmapItem[]; later: RoadmapItem[] } = {
  now: [
    { title: "The console catches up to the API", note: "Simulation, policy packs, capability rules, and the audit feed are governed in the API today; bringing them into the operator console so you click what you currently curl." },
    { title: "Governed in every runtime", note: "One authorization plane, wherever the agent runs — MCP, the SDK, and drop-in adapters for the frameworks agents are actually built on. Add Sanction in front of any tool server." },
    { title: "Sequential simulation", note: "Today's what-if holds recorded state constant; next it replays the week in order — an early simulated denial frees budget for the request that came after, exactly as it would have lived." },
  ],
  next: [
    { title: "Policy packs by channel", note: "Starting policies shaped to how agents actually work — a coding-agent pack, a contractor-seat pack, a gateway-token-budget pack — each previewable against your real history before you apply it." },
    { title: "Budget reallocation", note: "Move unused budget across the account tree to where it's needed — leftover tokens become working capital, and the reallocation shows up in the audit." },
    { title: "Sanction Local", note: "Private AI on hardware you own — local models, zero egress by design, and a signed audit trail your assessor can read. Regulated practices first." },
  ],
  later: [
    { title: "Tamper-evident audit exports", note: "Hash-chained, exportable decision history — governance as cryptographic evidence." },
    { title: "Customer-managed keys + SOC 2", note: "Bring-your-own encryption keys and the compliance attestations enterprises require." },
    { title: "Mandate authority (AP2 / x402)", note: "Hold the mandate, not the rail — policy, consent, and audit in front of whichever agent-payment standard wins." },
  ],
}
