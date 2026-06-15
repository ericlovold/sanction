# Sanction — Positioning & Narrative

> How Sanction should describe itself, the category it plays in, and the wedge. Grounded in `MARKET.md` (cited) and the code reality in `DISCOVERY.md`.

## 1. The category (and the naming reality)

The category is real and analyst-recognized but **the name is unsettled** — competing labels in mid-2026: "non-human identity (NHI)," "agentic IAM," "agent control plane," "identity-first control plane" (Microsoft), "Agentic AI Ecosystem Security" (Gartner Emerging Tech radar, Oct 2025). NHI/agentic-IAM have the most analyst traction; "control plane / trust layer" is mostly VC/vendor framing.

**Do not invent a new category.** Position inside the one buyers are already learning, with a sharp sub-claim. The most useful taxonomy (from the governance research) splits the field into four layers vendors routinely blur:

| Layer | What it does | Examples |
|---|---|---|
| 1. Observability/eval | *Watch & score* runs | LangSmith, Langfuse, Arize |
| 2. AI gateways | *Route, cache, cap* spend/rate at the LLM call | LiteLLM, Portkey, Kong, Cloudflare |
| 3. Guardrails | *Filter content* (PII, jailbreaks) | Guardrails AI, NeMo, Lakera |
| **4. Pre-action authorization** | **Decide if the *action* (tool call / spend) is allowed before it runs, with credentials + audit** | **AWS Bedrock AgentCore Policy, Sanction** |

**Layer 4 is the youngest and least crowded.** The closest production incumbent, AWS AgentCore Policy (Cedar, GA ~2026), authorizes *tool calls* but **not budgets/spend, and only inside Bedrock**. There is no obvious dominant **vendor-neutral, framework-agnostic** player that unifies **spend authorization + scoped credential injection + audit**. That gap is Sanction's home.

## 2. The one-liner (options, ranked)

1. **"The authorization layer for agents that act."** — Sanction decides whether an agent may spend or use a secret, before it does, and logs it. *(Recommended: claims Layer 4, neutral, not over-stated as a wallet.)*
2. **"Vault + spend control + audit for AI agents, in one API."** — concrete, bundles the three pillars.
3. ~~"Stripe for agents"~~ — **avoid**: implies money movement Sanction doesn't do, and collides with Stripe's actual ACP/Issuing-for-agents.
4. ~~"Vault for agents"~~ — **avoid**: HashiCorp, Akeyless, Infisical, 1Password all credibly claim this; you'd be fighting on their turf with their word.

> **Recommended framing:** *"Sanction is the pre-action authorization and credential layer for autonomous agents — the check an agent runs before it spends money or touches a secret, with every decision scoped, short-lived, and audited."*

## 3. The wedge

**Who:** developers building agents that must *act* (A2A/MCP ecosystem, vertical-agent startups, internal autonomy teams like the sibling AIIA) — **not** enterprise security buyers first.

**Why them:** the identity incumbents (Okta Auth0-for-AI-Agents, Microsoft Entra Agent ID GA, Ping, SailPoint) and the NHI startups (Astrix, Oasis $120M, Aembit) are running a **top-down enterprise land-grab**. The payment giants (Stripe ACP, Mastercard, Visa, AP2, x402) own the rails. Both leave a gap: a **developer-first, embeddable, rail-neutral** layer you add in minutes. Sanction already ships REST + **MCP** + Bedrock — distribution that rides the ecosystem the incumbents sell *to*.

**The three-part wedge:**
1. **DX-led, ecosystem-distributed.** "npm-install your agent a spend cap and a scoped secret." This requires the SDK (BACKLOG N-5) and the auth fix (S-1).
2. **The neutral brain above the rails.** With ACP/AP2/x402/card-network schemes fragmenting, a policy+consent+audit layer that sits in front of *whichever* rail wins is durable. AP2's own purpose — "prove a real user authorized a specific purchase" via signed mandates — *is Sanction's job description*; Sanction can be the thing that issues and holds those mandates.
3. **One primitive, not three tools.** Few combine scoped credential injection **+** spend authorization **+** unified audit for the agent *builder*. That bundle is the differentiated shape.

## 4. Proof points Sanction can credibly claim today (and what to fix first)

**Credible now:** scoped, short-lived (≤60 min), audited credential injection; deny-by-default spend policy with escalation; MCP-native distribution. This architecture maps directly onto what Vault (ephemeral per-request auth), Infisical (injection proxy), and Aembit (MCP gateway) are building — i.e., Sanction is in a real, contested, well-funded category, not a niche.

**Compliance-by-architecture is a positioning asset:** by *authorizing and logging* rather than custodying funds, Sanction stays out of money-transmitter (FinCEN MSB / 50-state MTL) and PCI cardholder-data scope, while its 15-min scoped JWTs + per-access audit already align with SOC 2 CC6/CC7. Lead with this for security-conscious buyers. (See DECISIONS ADR-0005; never store raw PANs.)

**Must fix before making security claims publicly** (these undercut the entire narrative if discovered): the unauthenticated management endpoints and the credential-disclosure chain (SECURITY-THREAT-MODEL F1–F4), and the over-claims (clearance/per-execution-budget/wallet) flagged in PRODUCT §6. A security product caught over-claiming or with an open vault loses the only thing it sells: trust.

## 5. Narrative arc (how the story should mature)
- **Today:** "The authorization + credential layer for agents — secure by architecture, developer-first." (Trim the 'wallet that holds funds' claim.)
- **As enforcement lands:** add per-execution budgets, policy management, clearance enforcement → "programmable governance for agent actions."
- **As the ecosystem settles:** "the neutral consent + audit layer in front of any agent-payment rail (ACP/AP2/x402)." This is the defensible long-term position regardless of which rail wins.
