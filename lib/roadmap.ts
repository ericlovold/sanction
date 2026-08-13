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
// framework adapters, tamper-evident audit exports, the Local install package,
// and observe-mode adoption are shipped (see the changelog) → now, ecosystem
// distribution → next, the published SDK + Python adapters and simulation all
// the way down → later, enterprise trust.

export type RoadmapItem = { title: string; note: string }

export const ROADMAP: { now: RoadmapItem[]; next: RoadmapItem[]; later: RoadmapItem[] } = {
  now: [
    { title: "The agent wallet", note: "Shipping: Sanction MCP is the wallet an agent carries, not another tool server. A **Wallet Card** at `/.well-known/wallet-card.json` is how other agents discover carry / present / verify. **`POST /v1/mandate/verify`** lets a counterparty check a presented execution JWT with no API key. stdio MCP stays cooperative — the honesty contract is on the card. Next after this: the hosted remote MCP endpoint, then broker mode that intercepts `tools/call`." },
    { title: "Adopt without flipping the switch", note: "Shipped: **observe mode** runs the real decision engine on a live fleet and records exactly what it would have done — blocking nothing, moving no counters — so you watch a week of would-be denials and the dollars behind them on the Observe console, then flip each pool to enforce in one confirm-gated click, the revision chain marking when enforcement went live. The do-nothing on-ramp: adopt quietly, enforce when the numbers convince you." },
    { title: "Sanction Local: from runtime to install", note: "Shipped: the air-gapped runtime (local models, fail-closed egress denial, every denied attempt in the audit trail) now has its install package — the **no-egress** policy pack (only on-box tools pass; cloud calls deny and persist) and the Audit console's signed, hash-chained evidence download an assessor verifies self-contained. Regulated practices first." },
    { title: "Distribution by channel", note: "Compatibility badges, channel-shaped policy packs, and install paths for MCP hosts, coding agents, LLM gateways, agencies, and payment-agent pilots — each previewable against your real history before you apply it." },
    { title: "Governed in every runtime", note: "One authorization plane, wherever the agent runs — MCP (the wallet the agent carries), the SDK's framework adapters (the tool executes behind the decision, shipped for TypeScript and the Vercel AI SDK), and Bedrock. Hosted MCP that sits in front of any tool server is the next front door, not a claim we make on stdio today." },
    { title: "Tamper-evident audit exports", note: "Shipped: the decision history exports as a signed, hash-chained document any recipient can verify self-contained — altering, dropping, or reordering a row names the broken link. Governance as cryptographic evidence." },
    { title: "Approve without leaving Slack", note: "Shipped: incoming webhooks still deep-link. Interactive **Approve/Deny** posts via the Slack app (`chat.postMessage`) when you paste a channel archive URL and set `SANCTION_SLACK_SIGNING_SECRET` + `SANCTION_SLACK_BOT_TOKEN`. Same `resolveApproval` path as the dashboard. MCP Apps wait on the v2 SDK." },
  ],
  next: [
    { title: "Hosted remote MCP — the wallet endpoint", note: "stdio is a client. The launch is a URL: OAuth or API-key onboarding, Streamable HTTP, the agent is issued a wallet endpoint. v1 can still be cooperative. v1.1 is broker mode — Sanction fronts other MCP servers and intercepts `tools/call` through the existing `/authorize/tool` ladder, the way the LLM gateway already intercepts inference." },
    { title: "The published SDK + the Python side", note: "@sanction/sdk is publish-ready (0.6.0, FSL, escalate-loop helpers) — run the publish-sdk workflow once the npm org is wired. Next: the adapters where Python agents live — a LiteLLM callback and LangChain/LangGraph + CrewAI bindings over the same core, each with a runnable example." },
    { title: "Sequential simulation, all the way down", note: "Sequential replay shipped for per-agent budgets; next it threads pooled and subtree caps too, and the console's simulation preview grows an as-recorded vs sequential toggle." },
  ],
  later: [
    { title: "Audit chain anchors", note: "Exports are tamper-evident today; anchoring each export's head to the next seals the history across time — evidence that outlives any single document." },
    { title: "Customer-managed keys + SOC 2", note: "Bring-your-own encryption keys and the compliance attestations enterprises require." },
    { title: "Mandate authority (AP2 / x402)", note: "Hold the mandate, not the rail — policy, consent, and audit in front of whichever agent-payment standard wins. First slice shipped: pay-per-crawl quotes (Cloudflare, x402-settled) governed as spend decisions via the SDK\u2019s sanctionedFetch. Next: settlement reconciliation (crawler-charged receipts vs decisions) and mandate scopes." },
  ],
}
