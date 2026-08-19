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
// observe-mode adoption, the wallet as a public pasteable object (Wallet Card,
// mandate verify, the hosted /mcp URL), Slack OAuth install with interactive
// approvals, and the roster console with team roles are shipped (see the
// changelog) → now, ecosystem
// distribution → next, the published SDK + Python adapters and simulation all
// the way down → later, enterprise trust.

export type RoadmapItem = { title: string; note: string }

export const ROADMAP: { now: RoadmapItem[]; next: RoadmapItem[]; later: RoadmapItem[] } = {
  now: [
    { title: "The agent wallet", note: "Shipped: Wallet Card at `/.well-known/wallet-card.json`, **`POST /v1/mandate/verify`**, and a **hosted wallet URL** at `/mcp` (Streamable HTTP, agent API key). stdio and the URL are both cooperative — the honesty contract is on the card. Next: broker mode that intercepts `tools/call`." },
    { title: "Adopt without flipping the switch", note: "Shipped: **observe mode** runs the real decision engine on a live fleet and records exactly what it would have done — blocking nothing, moving no counters — so you watch a week of would-be denials and the dollars behind them on the Observe console, then flip each pool to enforce in one confirm-gated click, the revision chain marking when enforcement went live. The do-nothing on-ramp: adopt quietly, enforce when the numbers convince you." },
    { title: "Sanction Local: from runtime to install", note: "Shipped: the air-gapped runtime (local models, fail-closed egress denial, every denied attempt in the audit trail) now has its install package — the **no-egress** policy pack (only on-box tools pass; cloud calls deny and persist) and the Audit console's signed, hash-chained evidence download an assessor verifies self-contained. Regulated practices first." },
    { title: "The console is a roster, and wallets have people", note: "Shipped: the dashboard home is a **roster** — the wallet tree as groups, agents as cards, a mandate stamp (live / paused / blocked) on each — with the rail trimmed to three items. Wallets now carry **people**: team membership with roles, a wallet switcher that reaches every membership, and a viewer role that cannot mutate; an org owner decides escalations anywhere in their subtree. **Month runway** draws cumulative burn against the monthly cap with the projected exhaust date, and **seat health** flags the seats whose denial rate is hot or climbing, each with the decision code it keeps hitting. Operators get numbers they can act on, not a monthly report of zeros." },
    { title: "Distribution by channel", note: "Compatibility badges, channel-shaped policy packs, and install paths for MCP hosts, coding agents, LLM gateways, agencies, and payment-agent pilots — each previewable against your real history before you apply it." },
    { title: "Governed in every runtime", note: "One authorization plane, wherever the agent runs — MCP (stdio or the hosted `/mcp` URL), the SDK's framework adapters (the tool executes behind the decision, shipped for TypeScript and the Vercel AI SDK), and Bedrock. Broker mode that sits in front of any tool server is Next, not a claim we make on the URL today." },
    { title: "Tamper-evident audit exports", note: "Shipped: the decision history exports as a signed, hash-chained document any recipient can verify self-contained — altering, dropping, or reordering a row names the broken link. Governance as cryptographic evidence." },
    { title: "Approve without leaving Slack", note: "Shipped: incoming webhooks still deep-link. Interactive **Approve/Deny** posts via the Slack app (`chat.postMessage`). **Add to Slack** installs per workspace (OAuth) and encrypts the bot token on the wallet; pasted channel archive URLs plus `SANCTION_SLACK_BOT_TOKEN` remain the platform-token fallback. Same `resolveApproval` path as the dashboard. MCP Apps wait on the v2 SDK." },
  ],
  next: [
    { title: "Hosted MCP broker — intercept tools/call", note: "v1 issued the URL. v1.1 is broker mode — Sanction fronts other MCP servers and intercepts `tools/call` through the existing `/authorize/tool` ladder, the way the LLM gateway already intercepts inference. That is what makes \"a hijacked agent cannot spend\" true. Until then, do not claim interception on MCP. OAuth onboarding follows the API-key paste." },
    { title: "Per-agent Wallet Cards", note: "This seat, this remaining budget band, never the key. Attach to A2A Agent Cards so a peer can fetch constraints before a task. The platform card at `/.well-known/wallet-card.json` is the issuer's card." },
    { title: "Decision receipts", note: "A hash-chained slip both parties keep after a governed action. AUDIT-1 is wallet-scoped export; A2A needs per-decision. Same carry / present / verify / evidence pathway — not a parallel log." },
    { title: "The published SDK + the Python side", note: "Shipped: **`npm install sanction-sdk`** is live (0.8.0, FSL, zero runtime dependencies — renamed from the planned `@sanction/sdk` scope to publish unscoped like `sanction-mcp`). `SanctionClient` + `SanctionAdminClient`, the escalate→grant loop, and the framework adapters. Next: the adapters where Python agents live — a LiteLLM callback and LangChain/LangGraph + CrewAI bindings over the same core, each with a runnable example. Next: the adapters where Python agents live — a LiteLLM callback and LangChain/LangGraph + CrewAI bindings over the same core, each with a runnable example." },
    { title: "Sequential simulation, all the way down", note: "Sequential replay shipped for per-agent budgets; next it threads pooled and subtree caps too, and the console's simulation preview grows an as-recorded vs sequential toggle." },
  ],
  later: [
    { title: "Audit chain anchors", note: "Exports are tamper-evident today; anchoring each export's head to the next seals the history across time — evidence that outlives any single document." },
    { title: "Customer-managed keys + SOC 2", note: "Bring-your-own encryption keys and the compliance attestations enterprises require." },
    { title: "Mandate authority (AP2 / x402)", note: "Hold the mandate, not the rail — policy, consent, and audit in front of whichever agent-payment standard wins. First slice shipped: pay-per-crawl quotes (Cloudflare, x402-settled) governed as spend decisions via the SDK\u2019s sanctionedFetch. Next: settlement reconciliation (crawler-charged receipts vs decisions) and mandate scopes." },
  ],
}
