# Sanction — Architecture Roadmap & Market POV

> Financial control + identity for autonomous AI agents.
> Last updated: 2026-06-14. Owner: Eric Lovold.

---

## The thesis (one paragraph)

Agents are crossing from "assistants that suggest" to "autonomous actors that
spend, transact, and act on credentials." The layer the whole ecosystem is
missing is **neutral, cross-provider financial control + identity**. Every major
platform is building a vertical agent stack, but none will govern another's
agents — so the horizontal control plane is open, and that's Sanction.

**Cost governance is the foot in the door** (acute pain today). **Spend
authorization + credential/identity governance is the moat** (where the market
is going). We've already built both halves. The strategic job now is
distribution and neutrality, not more core features.

The non-obvious bet: the inflection isn't "better agents," it's **agents
touching money and credentials**. That's a finance/security/compliance buyer,
not a dev-tools buyer — and it's exactly where the product points.

---

## Where agent autonomy goes — 6-18 months

| Window | What changes | Implication for Sanction |
|---|---|---|
| **0–6 mo** | Autonomous coding/ops agents are mainstream; they burn tokens, hit paid APIs, spin compute unsupervised. MCP is the de-facto tool/connectivity standard. The "agent with my API key + card" fear is visceral. | **Cost governance is the wedge.** Be the 1-line gateway/MCP integration that meters + caps. Distribution through coding agents. |
| **6–12 mo** | **Agentic commerce inflects** — agents make real purchases via emerging rails (Stripe Agent Toolkit, Google AP2 / Agent Payments Protocol, x402, Coinbase agent wallets). Per-agent + org-level budgets become a real need as fleets grow. | **Spend authorization + approval loops become the product.** Be the *policy/approval layer on top of any rail* — rail-agnostic. This is the differentiation vs. observability tools. |
| **12–18 mo** | Agents as economic actors → **compliance/audit pressure** (spend controls + audit trails become required). Agent *identity* + *integrity* standards firm up: who is this agent, what's it authorized to do, **and can I trust it hasn't been compromised**. | **Identity + integrity + audit + chargeback = the enterprise sale.** Neutrality matters most here — enterprises run heterogeneous fleets and need ONE control plane. |

---

## Where devs are building now (the surfaces that matter)

1. **Coding agents** — Cursor, Claude Code, Codex, Copilot agents. The beachhead:
   real autonomous agents spending real tokens *today*.
2. **Agent frameworks/SDKs** — Claude Agent SDK, OpenAI Agents SDK, LangGraph,
   CrewAI, Vercel AI SDK, Mastra/Pydantic AI.
3. **Cloud agent runtimes** — AWS Bedrock AgentCore, Google Vertex Agent Engine,
   Azure AI Foundry.
4. **Payment rails** — Stripe Agent Toolkit, AP2, x402, Coinbase — the
   *execution* layer our policy layer sits above.
5. **MCP** cuts across all of the above as the connective tissue.

Sanction needs to be a **1-line integration** at layers 1–2 now, and a **named
integration** at layers 3–4 as they mature.

---

## Platform-by-platform read

| Platform | What it is | Relationship | The move |
|---|---|---|---|
| **Cursor** | IDE-native coding agent; controls *its own* model billing for users | **Distribution surface, not competitor.** It governs its model layer; we govern the agent's *outbound* spend/secrets/actions. MCP-supported. | List `sanction-mcp`; "govern what your Cursor agent does with your keys/budget." |
| **Claude Code** | CLI agent + Agent SDK; MCP-native (we dogfood it) | **Best near-term channel.** SDK is where prod agents get built → we govern them. | MCP server (done) + gateway + a thin Agent SDK wrapper. |
| **Codex (OpenAI)** | Agentic coding (CLI/cloud) + Agents SDK | **Same as Claude Code, other provider.** Our provider-agnostic gateway already covers OpenAI. | Don't pick sides — neutrality is the asset. SDK middleware for both. |
| **Bedrock / AWS AgentCore** | AWS's agent runtime: Gateway, **Identity**, Memory, Observability, Runtime | **The one to watch — partial overlap.** AgentCore has identity + tool gateway, but it's AWS-centric, runtime-focused, and **not financial-governance** (no budget enforcement / approve-before-spend / chargeback / cross-provider). | **Ride, don't fight.** Build a Sanction-for-AgentCore integration: the spend-governance + approval layer AgentCore lacks, for AgentCore agents *and* everything else. |

**The strategic crux:** the platforms will each bundle *some* governance, but
they're self-interested and siloed — Anthropic won't govern your OpenAI spend;
AWS won't govern your non-AWS agents. **The durable moat is neutrality +
cross-runtime reach.** It's not a feature they can copy without abandoning their
own lock-in.

---

## Architectural roadmap

### Now — control-plane MVP (shipped; harden distribution)
Wallet, policy, authorize ladder, vault, clearance, gateway, approvals,
webhooks, rate limiting. → Ship SDK middleware (Anthropic + OpenAI + Gemini),
publish the MCP package, get listed everywhere devs look.

### Next (3–9 mo) — neutrality + identity
- **Gateway as the universal enforcement point** (provider-agnostic metering +
  budget — already there; make it the headline).
- **Vault-injected provider keys** — agent never holds the key; Sanction injects
  it. The bridge to identity.
- **Sanction ID** — verifiable agent identity + **integrity attestation**: who is
  this agent, what's it cleared for, *and can I prove it hasn't been tampered
  with (injected prompts, swapped tools, malware)* before it gets credentials or
  spend authority. See `docs/NEXT-TIER.md`.
- **Org/team layer** — fleets, roles, chargeback by team/cost-center, SSO, audit
  export. The enterprise conversion path.

### Then (9–18 mo) — agent commerce governance
- Integrate payment rails (Stripe Agent Toolkit, AP2, x402) as *execution
  backends* we authorize. "Agent calls authorize → Sanction decides → rail
  executes → Sanction logs." Rail-agnostic by design.
- Position: **the approval + identity + audit layer for agent commerce** — the
  thing a CFO signs off on before agents transact.

---

## Bets & risks (named honestly)

**Bets**
1. **Neutrality wins** — be the cross-provider/cross-runtime control plane while
   everyone else builds silos.
2. **Distribution = integration depth** — 1-line wrappers + MCP + listings beat
   any feature.
3. **The gateway is the wedge** — zero-instrumentation cost governance today,
   spend-authorization tomorrow, commerce-approval after.

**Risks (and mitigations)**
- **Platform encroachment** (AWS/Anthropic bundle governance): mitigate with
  neutrality, speed, and integrating *on* their platforms rather than competing.
- **Timing** (agent commerce still nascent): cost-governance carries
  revenue/adoption until commerce matures — don't over-invest in rails early.
- **Standards risk** (agent identity/payment protocols forming — AP2, MCP auth):
  align with them early, don't invent a competing standard.

---

## The one-sentence steer

Stay the **neutral financial-control + identity plane** for agents, distribute
through the coding-agent/MCP/SDK surfaces now, be ready to be the approval layer
the moment agents start spending real money — and **integrate onto Bedrock**
rather than treating AWS as a competitor.
