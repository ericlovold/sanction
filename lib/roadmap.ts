// Curated public roadmap. Hand-picked Now / Next / Later — you control exactly
// what's exposed. Security-gate work (envelope encryption, tenant isolation, key
// rotation) is intentionally NOT listed here; keep the gate private until it
// ships, then announce it in the changelog. Edit freely — this is the public face
// of the backlog, not a live mirror of it.
//
// Principle: the roadmap leads the product by ~one release, never lags it. "Now"
// is what's shipped/shipping; "Next" leads by one release; "Later" is the arc.
// The arc reads: the engine, approvals→grants, seats, standards (AuthZEN/AARP),
// evidence+replay, capability governance, simulation, policy packs, console parity,
// gateway fail-closed metering, the Local runtime, and outcome governance
// (cost-per-outcome ceilings, freeze, reallocation) are shipped (see the
// changelog) → now, Local install package + ecosystem distribution → next,
// sequential simulation + drop-in adapters → later, cryptographic audit +
// enterprise trust.

export type RoadmapItem = { title: string; note: string }

export const ROADMAP: { now: RoadmapItem[]; next: RoadmapItem[]; later: RoadmapItem[] } = {
  now: [
    { title: "Sanction Local: from runtime to install", note: "The air-gapped runtime is real — local models, fail-closed egress denial, every denied attempt in the audit trail (see the changelog). Now the install package around it: the no-egress policy pack, and the evidence export an assessor reads without asking you to explain it. Regulated practices first." },
    { title: "Distribution by channel", note: "Compatibility badges, channel-shaped policy packs, and install paths for MCP hosts, coding agents, LLM gateways, agencies, and payment-agent pilots — each previewable against your real history before you apply it." },
    { title: "Governed in every runtime", note: "One authorization plane, wherever the agent runs — MCP, the SDK, and drop-in adapter paths for the frameworks agents are actually built on. Add Sanction in front of any tool server." },
  ],
  next: [
    { title: "Sequential simulation", note: "Today's what-if holds recorded state constant; next it replays the week in order — an early simulated denial frees budget for the request that came after, exactly as it would have lived." },
    { title: "Framework adapters", note: "Drop-in hooks for LangChain, CrewAI, Vercel AI SDK, and LiteLLM — not just docs, but the adapter code that routes every tool call and model request through Sanction before it executes." },
  ],
  later: [
    { title: "Tamper-evident audit exports", note: "Hash-chained, exportable decision history — governance as cryptographic evidence." },
    { title: "Customer-managed keys + SOC 2", note: "Bring-your-own encryption keys and the compliance attestations enterprises require." },
    { title: "Mandate authority (AP2 / x402)", note: "Hold the mandate, not the rail — policy, consent, and audit in front of whichever agent-payment standard wins." },
  ],
}
