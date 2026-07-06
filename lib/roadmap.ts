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
// shipped (see the changelog), and the console caught up + the Local runtime
// went air-gapped (2026-07-06) → now, the Local install package + govern every
// runtime + sequential simulation → next, approval channels + channel packs +
// reallocation → later, cryptographic audit + enterprise trust.

export type RoadmapItem = { title: string; note: string }

export const ROADMAP: { now: RoadmapItem[]; next: RoadmapItem[]; later: RoadmapItem[] } = {
  now: [
    { title: "Sanction Local: from runtime to install", note: "The air-gapped runtime is real — local models, fail-closed egress denial, every denied attempt in the audit trail (see the changelog). Now the install package around it: the no-egress policy pack, and the evidence export an assessor reads without asking you to explain it. Regulated practices first." },
    { title: "Governed in every runtime", note: "One authorization plane, wherever the agent runs — MCP, the SDK, and drop-in adapters for the frameworks agents are actually built on. Add Sanction in front of any tool server." },
    { title: "Sequential simulation", note: "Today's what-if holds recorded state constant; next it replays the week in order — an early simulated denial frees budget for the request that came after, exactly as it would have lived." },
  ],
  next: [
    { title: "Approvals that find you", note: "Escalations reach the right human where they already are — email first, then Slack routing — with one-glance context to decide, and a timeout policy so nothing deadlocks waiting." },
    { title: "Policy packs by channel", note: "Starting policies shaped to how agents actually work — a coding-agent pack, a contractor-seat pack, a gateway-token-budget pack — each previewable against your real history before you apply it." },
    { title: "Budget reallocation", note: "Move unused budget across the account tree to where it's needed — leftover tokens become working capital, and the reallocation shows up in the audit." },
  ],
  later: [
    { title: "Tamper-evident audit exports", note: "Hash-chained, exportable decision history — governance as cryptographic evidence." },
    { title: "Customer-managed keys + SOC 2", note: "Bring-your-own encryption keys and the compliance attestations enterprises require." },
    { title: "Mandate authority (AP2 / x402)", note: "Hold the mandate, not the rail — policy, consent, and audit in front of whichever agent-payment standard wins." },
  ],
}
