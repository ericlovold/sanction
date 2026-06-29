// Curated public roadmap. Hand-picked Now / Next / Later — you control exactly
// what's exposed. Security-gate work (envelope encryption, tenant isolation, key
// rotation) is intentionally NOT listed here; keep the gate private until it
// ships, then announce it in the changelog. Edit freely — this is the public face
// of the backlog, not a live mirror of it.

export type RoadmapItem = { title: string; note: string }

export const ROADMAP: { now: RoadmapItem[]; next: RoadmapItem[]; later: RoadmapItem[] } = {
  now: [
    { title: "Simulation mode", note: "Validate your spend policy end-to-end before any real money flows." },
    { title: "Typed, remediable deny responses", note: "Every denial returns a machine-readable code + a fix hint so an agent can replan without a human." },
    { title: "MCP registry listing", note: "First-class discovery so any MCP host can add Sanction in one step." },
  ],
  next: [
    { title: "First-class escalation + timeout fallback", note: "A dedicated escalate state with a guaranteed terminal outcome — no deadlocks." },
    { title: "Policy templates + plain-English clearance", note: "Start from sensible presets; read your guardrails in words, not cents." },
    { title: "One-glance spend dashboard", note: "What did my agents spend today, and where — answered in a single view." },
  ],
  later: [
    { title: "Tamper-evident audit log + export", note: "Hash-chained, exportable decision history — governance as cryptographic evidence." },
    { title: "Bring-your-own-key + SOC 2", note: "Customer-managed encryption keys and the compliance attestations enterprises require." },
    { title: "Rail-neutral payment facilitation (AP2 / x402)", note: "Be the policy + consent + audit layer in front of whichever agent-payment rail wins." },
  ],
}
