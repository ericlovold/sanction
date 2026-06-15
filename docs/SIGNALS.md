# Sanction — Market Signals (living)

> Standing watch on market shifts, competitor moves, new standards, and demand signals. **Each entry links to a backlog/roadmap implication.** Revisit every cycle; promote recurring signals into `BACKLOG.md` and re-rank. Newest first. Sourcing detail and confidence live in `MARKET.md`.

## How to use this file
1. Log a signal (what changed, source, date).
2. State the **implication** for Sanction.
3. File or update a `BACKLOG.md` item and link it.
4. If a signal invalidates a thesis, open an ADR in `DECISIONS.md`.

---

## 2026-06-15 — Initial scan

### SIG-001 · Hyperscalers + identity incumbents shipped agent-identity primitives (12 months)
Microsoft **Entra Agent ID** (GA), Okta **Auth0 for AI Agents** + **Cross-App Access** (GA Nov 2025), **Google Cloud Agent Identity** (SPIFFE-based), AWS **Bedrock AgentCore Identity** (GA Oct 2025), Ping & SailPoint agent-identity GA. ([MARKET §2a](MARKET.md))
- **Implication:** the enterprise *identity* slice is a crowded incumbent land-grab. Sanction must **not** compete head-on as "agent IdP." Wedge = developer-first, embeddable, rail-neutral, MCP-distributed (POSITIONING §3).
- **Backlog:** reinforces N-5 (SDK), S-1 (auth) for embeddability; do **not** build an enterprise IdP.

### SIG-002 · "Pre-action authorization" is forming as a distinct, thin layer
AWS **Bedrock AgentCore Policy** (Cedar, deny-by-default, evaluates every tool call incl. MCP args; preview Dec 2025 / GA ~2026) is the closest production analog — but **tool-calls only, no spend/budget, Bedrock-locked**. Academic work ("Before the Tool Call," arXiv 2603.20953) + MS Defender for AI Agents + HITL primitives in OpenAI/MS agent SDKs. ([MARKET §2d](MARKET.md))
- **Implication:** this is Sanction's category (Layer 4) and it has **no neutral, framework-agnostic incumbent unifying spend + credentials + audit**. Strong reason to sharpen the "authorization layer for agents that act" positioning and ship fast.
- **Backlog:** validates the whole roadmap; prioritize N-1/N-3 (policy + per-execution budget) to own "spend" where AgentCore Policy doesn't.

### SIG-003 · Agent-payment standards are proliferating and fragmenting
**ACP** (OpenAI+Stripe, live), **AP2** (Google, 60+ partners, → FIDO), **x402** (Coinbase, Linux Foundation), **Mastercard Agent Pay**, **Visa Intelligent Commerce/Trusted Agent Protocol**. No winner; much is pilot-stage. ([MARKET §2c](MARKET.md))
- **Implication:** betting on one rail is risky; the durable position is the **neutral consent/audit brain above the rails**. AP2's "signed mandate proving a user authorized a specific purchase" ≈ Sanction's job — Sanction could issue/hold those mandates.
- **Backlog:** new **L-8 — AP2/ACP mandate adapter** (later); keep ADR-0005 (control-plane vs custody) open.

### SIG-004 · Direct credential-injection-for-payments startup exists (Nekuda)
**Nekuda** ($5M, Amex/Visa Ventures) ships a "Secure Agent Wallet" that **delegates payment credentials to an agent for storage/injection at checkout** — functionally mirrors Sanction's vault-inject. Also Skyfire (identity+payments), Payman (policy+HITL), Catena Labs ($48M, filing for a trust-bank charter). ([MARKET §2c](MARKET.md))
- **Implication:** the vault-inject mechanism is validated *and* contested. Differentiate on the **bundle** (spend policy + vault + audit + clearance) and DX, not the mechanism alone.
- **Backlog:** sharpen N-5 (SDK) and N-1/N-2 (policy/escalation) as the bundle's differentiators.

### SIG-005 · NHI / "agentic AI security" is a funded, consolidating category
Gartner named **"Agentic AI Ecosystem Security"** (Emerging Tech radar, Oct 2025); **Oasis** raised $120M for "Agentic Access Management"; **Astrix** (Gartner-named, reported Cisco acquisition talks — UNVERIFIED); **Aembit** MCP Identity Gateway; AI secrets leaks +81% in 2025. ([MARKET §2b](MARKET.md))
- **Implication:** category tailwind is real; so is competition and likely M&A. Trust/proof (SOC 2, clean key mgmt) becomes a *competitive* requirement, not just hygiene.
- **Backlog:** raises priority of L-1 (KMS/envelope), L-2 (tamper-evident audit), L-5 (SOC 2) on the "earn enterprise trust" track.

### SIG-006 · MCP authorization standardized on OAuth 2.1 (+ RFC 8707 resource indicators)
MCP servers are now OAuth Resource Servers; PKCE mandatory; Nov 2025 external-OAuth flows. Sanction already ships an MCP server. ([MARKET §2a](MARKET.md))
- **Implication:** align Sanction's MCP server with the current MCP auth spec to be a first-class citizen in compliant hosts (and to interoperate with Auth0/Entra/Cognito as auth servers).
- **Backlog:** new **N-8 — bring MCP server up to 2025-11 auth spec** (OAuth 2.1 RS, resource indicators).

### SIG-007 · Compliance path is binary: avoid custody or become a bank
Catena Labs **filed for a trust-bank charter**; everyone else avoids money-transmitter status via tokenization + delegated credentials + BIN/bank partners. PCI scope collapses if you never store raw PANs; SOC 2 CC6/CC7 already match Sanction's scoped-JWT + audit design. ([MARKET §6](MARKET.md))
- **Implication:** Sanction's "authorize + log, don't custody" architecture is a **compliance moat** — keep it deliberately (ADR-0005-A). Never store raw PANs.
- **Backlog:** L-5 (SOC 2 readiness) is the monetization unlock; ADR-0005 decision pending founder.

---

## Watchlist (check next cycle)
- Okta "Okta for AI Agents" GA (expected Apr 2026) — feature scope vs. Sanction.
- HashiCorp Vault native AI-agent support (EA → public beta summer 2026) — closest infra incumbent.
- Whether AP2/ACP converge or a card-network scheme wins — decides the L-8 adapter target.
- Cisco/Astrix acquisition outcome — signals NHI consolidation pace.
- Any Gartner/Forrester quadrant for "agentic IAM" (none confirmed yet) — category legitimization.
