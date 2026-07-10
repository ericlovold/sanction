// Curated public roadmap. Hand-picked Now / Next / Later — you control exactly
// what's exposed. Security-gate work (envelope encryption, tenant isolation, key
// rotation) is intentionally NOT listed here; keep the gate private until it
// ships, then announce it in the changelog. Edit freely — this is the public face
// of the backlog, not a live mirror of it.
//
// Principle: the roadmap leads the product by ~one release, never lags it. "Now"
// is what's shipped/shipping; "Next" leads by one release; "Later" is the arc.
// The arc reads: the engine, approvals→grants, seats, standards (AuthZEN/AARP),
// evidence+replay, capability governance, simulation (incl. sequential replay),
// policy packs, console parity, gateway fail-closed metering, the Local runtime,
// outcome governance (cost-per-outcome ceilings, freeze, reallocation), the TS
// framework adapters, and tamper-evident audit exports are shipped (see the
// changelog) → now, Local install package + ecosystem distribution → next,
// the published SDK + Python adapters and simulation all the way down → later,
// enterprise trust.

export type RoadmapItem = { title: string; note: string }

export const ROADMAP: { now: RoadmapItem[]; next: RoadmapItem[]; later: RoadmapItem[] } = {
  now: [
    { title: "Sanction Local: from runtime to install", note: "The air-gapped runtime is real — local models, fail-closed egress denial, every denied attempt in the audit trail (see the changelog). Now the install package around it: the no-egress policy pack, and the evidence export an assessor reads without asking you to explain it. Regulated practices first." },
    { title: "Distribution by channel", note: "Compatibility badges, channel-shaped policy packs, and install paths for MCP hosts, coding agents, LLM gateways, agencies, and payment-agent pilots — each previewable against your real history before you apply it." },
    { title: "Governed in every runtime", note: "One authorization plane, wherever the agent runs — MCP, the SDK's framework adapters (the tool executes behind the decision, shipped for TypeScript and the Vercel AI SDK), and Bedrock. Add Sanction in front of any tool server." },
    { title: "Tamper-evident audit exports", note: "Shipped: the decision history exports as a signed, hash-chained document any recipient can verify self-contained — altering, dropping, or reordering a row names the broken link. Governance as cryptographic evidence." },
  ],
  next: [
    { title: "The published SDK + the Python side", note: "@sanction/sdk to npm, then the adapters where Python agents live — a LiteLLM callback and LangChain/LangGraph + CrewAI bindings over the same core, each with a runnable example." },
    { title: "Sequential simulation, all the way down", note: "Sequential replay shipped for per-agent budgets; next it threads pooled and subtree caps too, and the console's simulation preview grows an as-recorded vs sequential toggle." },
  ],
  later: [
    { title: "Audit chain anchors", note: "Exports are tamper-evident today; anchoring each export's head to the next seals the history across time — evidence that outlives any single document." },
    { title: "Customer-managed keys + SOC 2", note: "Bring-your-own encryption keys and the compliance attestations enterprises require." },
    { title: "Mandate authority (AP2 / x402)", note: "Hold the mandate, not the rail — policy, consent, and audit in front of whichever agent-payment standard wins." },
  ],
}
