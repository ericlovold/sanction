# Sanction — Market & Competitive Landscape

> Phase 3. Sourced web research; **every external claim carries a link**, and items I could not verify are marked **UNVERIFIED**. This space moves weekly — treat dated facts as point-in-time. Compiled June 2026.

## 1. The macro thesis (well-supported)

Autonomous agents are scaling from demos to fleets, and each one is a new identity that needs credentials, spend authority, and oversight — which most teams have *not* solved. Okta cites that **91% of organizations use AI agents but only ~10% have governance in place** ([Okta/Built In](https://builtin.com/articles/enterprise-identity-access-management)), AI-related secrets **surged 81% in 2025 to ~1.27M leaked incidents** ([GitGuardian](https://blog.gitguardian.com/nhi-security-tools/)), and IDC is cited projecting **up to 1.3B AI agents by 2028** ([Security Boulevard](https://securityboulevard.com/2025/08/top-non-human-identity-nhi-platforms-of-2025/)). The "agent needs to *act* safely" problem Sanction targets is real and acknowledged by the largest vendors.

## 2. The four adjacent markets Sanction sits between

Sanction's three pillars (wallet/spend authorization, credential vault, governance) straddle four distinct, fast-forming markets. This is both the opportunity (one coherent control plane) and the risk (four sets of well-funded incumbents).

### 2a. Agent identity & authorization
The hyperscalers and identity incumbents are modeling agents as **first-class identity principals**:
- **Microsoft Entra Agent ID**, **Okta** ("Okta for AI Agents," GA expected **April 2026**), and **Google Agent Identity for Vertex AI** ([Okta investor release](https://investor.okta.com/news-and-events/news-releases/news-details/2025/New-Okta-Platform-Innovations-Extend-Identity-Security-Fabric-to-Non-Human-Identities-in-an-Agentic-AI-Future/default.aspx), [The Register](https://www.theregister.com/2025/12/09/okta_agent_control/)).
- **OWASP published a Non-Human Identity Top 10 (2025)** (overprivileged machine identities, improper offboarding) ([GitGuardian](https://blog.gitguardian.com/nhi-security-tools/)).
- **MCP authorization standardized on OAuth 2.1** (March 2025; MCP servers classified as OAuth Resource Servers June 2025; mandatory PKCE; Nov 2025 external-OAuth flows) ([Auth0](https://auth0.com/blog/mcp-specs-update-all-about-auth/), [MCP spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)).
- **Google A2A** (Agent2Agent) shipped April 2025, grew to 150+ orgs ([Google Developers](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)).
- An emerging analyst category: **"Agentic Identity & Access Platforms (AIAP)"** ([SACR/Software Analyst](https://softwareanalyst.substack.com/p/emerging-agentic-identity-access)).

### 2b. Secrets management for AI / non-human identity (NHI)
A crowded, funded category directly overlapping Sanction's vault:
- **Incumbents:** HashiCorp Vault, AWS Secrets Manager, Infisical, Doppler, 1Password, Akeyless.
- **NHI-security startups:** Astrix, Oasis, Entro, Clutch, GitGuardian, **Aembit** (notable: *secretless* identity-based workload auth via an edge proxy — a different philosophy from Sanction's vault-and-inject) ([Security Boulevard](https://securityboulevard.com/2025/08/top-non-human-identity-nhi-platforms-of-2025/), [GitGuardian](https://blog.gitguardian.com/nhi-security-tools/)).
- **Astrix was named in a Gartner report** on identity-first agentic AI security ([Astrix](https://astrix.security/learn/blog/identity-the-missing-link-in-agentic-ai-security-astrix-named-in-new-gartner-report/)).

### 2c. Agent payments & wallets (the most active front)
This is where the standards war is loudest. Per cited research:
- **Agentic Commerce Protocol (ACP)** — OpenAI + Stripe, live Sept 2025, powering ChatGPT Instant Checkout (Etsy, Shopify) ([Stripe](https://stripe.com/blog/agentic-commerce-suite), [ACP repo](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol)).
- **AP2 (Agent Payments Protocol)** — Google-led, Sept 2025, 60+ partners (Mastercard, PayPal, Amex, Coinbase), ships as an A2A extension; **being donated to the FIDO Alliance** ([Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol)).
- **x402** — Coinbase, May 2025, revives HTTP 402 for onchain stablecoin micropayments; **adoption metrics (~69k agents, ~165M tx, ~$50M volume) are vendor-reported — UNVERIFIED** ([Coinbase](https://www.coinbase.com/developer-platform/discover/launches/x402)).
- **Mastercard Agent Pay** (April 2025, "Agentic Tokens") and **Visa Intelligent Commerce / Connect** (largely pilot-stage) ([Mastercard](https://www.mastercard.com/us/en/news-and-trends/press/2025/april/mastercard-unveils-agent-pay-pioneering-agentic-payments-technology-to-power-commerce-in-the-age-of-ai.html)).
- **Virtual-card issuing for agents:** **Stripe Issuing for agents** + Link-for-agents, **Lithic** (MCC allowlists, per-tx limits, Auth Stream Access) ([Stripe Issuing](https://docs.stripe.com/issuing/agents), [Lithic](https://www.lithic.com/blog/agentic-payments)).
- **Startups:** **Skyfire** (agent identity + payments, ~$9.5M raised), **Payman** ("AI that pays humans," wallets + policy + human approval, Visa investor), **Catena Labs** (Circle co-founder; $18M seed + $30M Series A, filed for a US trust-bank charter), **Nekuda** ($5M seed, Amex/Visa Ventures; **agent wallet + credential delegation/injection at checkout — closest functional analog to Sanction's vault-inject**) ([Skyfire](https://skyfire.xyz/skyfire-launches-identity-and-payments-for-autonomous-ai-agents/), [Nekuda](https://www.businesswire.com/news/home/20250514808097/en/)).

### 2d. Governance, policy & AI gateways
- **AI gateways** with built-in guardrails/governance: **Portkey** (1,600+ LLMs, 40+ guardrails), **Cloudflare AI Gateway** (rate limiting, guardrails) ([Portkey](https://github.com/Portkey-ai/gateway), [Cloudflare](https://www.cloudflare.com/products/ai-gateway/)).
- **Policy engines** repurposed for agent authz: **Open Policy Agent (OPA/Rego)** and AWS **Cedar** — "the missing guardrail for AI agents" ([Codilime](https://codilime.com/blog/why-use-open-policy-agent-for-your-ai-agents/)).
- **Agent observability** (adjacent, not competing): LangSmith, Langfuse, Arize.

## 3. Where Sanction sits vs. whom

| Competitor type | Examples | Overlap with Sanction | Sanction's angle |
|---|---|---|---|
| **Direct (agent wallet+identity+governance bundle)** | **Skyfire, Nekuda, Payman, Catena** | High — wallet + spend policy + (Nekuda) credential injection | Sanction bundles vault **+** spend policy **+** audit behind one developer API/MCP; most rivals lead with payment rails, not secrets |
| **NHI / secrets** | Vault, Aembit, Astrix, Infisical | Vault + scoping | Sanction is agent-runtime-native (short-lived scoped exec tokens, MCP-delivered) vs. infra-ops-native |
| **Identity incumbents** | Okta, Entra, Google | Agent identity + governance | Incumbents own enterprise IdP; Sanction can be the developer-first, embeddable layer that rides their identities |
| **Payment rails/standards** | Stripe ACP, AP2, x402, Mastercard, Visa | Spend authorization | **Complement, not compete** — Sanction is the *policy/consent/audit brain*; let the rails move money (see DECISIONS ADR-0005) |
| **AI gateways / policy** | Portkey, Cloudflare, OPA, Cedar | Policy enforcement | Sanction is spend/credential-specific, not a generic LLM proxy or raw policy engine |

## 4. Where a small team can realistically win a wedge

1. **Developer-first, embeddable, ecosystem-distributed.** Sanction already ships as REST + **MCP** + Bedrock. The incumbents (Okta/Microsoft) sell top-down to security buyers; the payment giants sell rails. A clean *"npm-install your agent a spend cap and a scoped secret in 5 minutes"* DX is an open lane (needs the SDK — BACKLOG N-5).
2. **The integration *brain*, not the rails.** The standards war (ACP vs AP2 vs x402 vs card networks) guarantees fragmentation. A neutral **policy + consent + audit layer that sits in front of whichever rail** is durable regardless of who wins. AP2's own framing ("prove a real user authorized a specific purchase") is *exactly* Sanction's job — Sanction can be the thing that produces/holds those mandates.
3. **Vault + spend + audit as one primitive.** Aembit does secretless workloads; Skyfire/Nekuda do payments; Astrix does NHI discovery. Few combine **scoped credential injection + spend authorization + a unified audit trail** for the *agent builder* in one API. That bundle is Sanction's differentiated shape.

## 5. The biggest market risks

1. **Absorption by giants.** Okta ("Okta for AI Agents," GA Apr 2026), Microsoft Entra Agent ID, and Google can fold agent identity+governance into platforms enterprises already buy. Stripe can extend Issuing/ACP to cover spend policy. *Mitigation: be developer-first and rail-neutral where they are platform-locked.*
2. **Standards haven't settled.** ACP, AP2, x402, MPP/UCP, Mastercard/Visa schemes all overlap; betting on one rail is risky. *Mitigation: stay the abstraction layer above them (ADR-0005-A).*
3. **"Agents paying for things" may lag the hype.** Much of Visa's program is pilot-stage and x402's volume is unverified. If autonomous spend stays small near-term, the *credential-vault + governance* value (which is needed today) must carry the product. *Mitigation: lead with the secrets+governance JTBD, treat payments as upside.*
4. **Crowded NHI field with funded incumbents** (Astrix in Gartner, Aembit's secretless model). Differentiation must be sharp and DX-led, not feature-parity.
5. **Trust bar is brutal for a security product.** A single breach is fatal. SOC 2, clean key management, and no over-claiming are prerequisites to enterprise revenue (see SECURITY-THREAT-MODEL).

## 6. Regulatory / compliance angle
- **If Sanction only authorizes + logs (today):** it largely avoids money-transmission/KYC and PCI cardholder-data scope. This is a feature — preserve it deliberately (ADR-0005).
- **If Sanction ever custodies/moves funds:** money-transmitter licensing, KYC, and PCI come into play. Catena Labs' response was to **file for a national trust-bank charter** — a signal of how heavy that path is. Payman advertises **SOC 2 / PCI** compliance as table stakes for an agent-payments product.
- **Selling a secrets vault to enterprises requires SOC 2 Type II** regardless of the payments question.

> Sources are linked inline. Funding figures sourced from aggregators (Tracxn/Crunchbase) and x402 adoption metrics are flagged UNVERIFIED. Re-verify before quoting externally.
