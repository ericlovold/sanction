# Sanction — Go-To-Market Strategy

> Partner strategy memo. Written 2026-06-20 against the live code, the security
> docs, and the market/positioning work already in `docs/`. This is the *strategy*;
> the ready-to-ship launch copy and day-by-day runbook live in `LAUNCH-WEEK.md`;
> new build items are appended to `BACKLOG.md`.

---

## 0. The one decision that shapes the launch

**Lead with the budget firewall. Demote the vault and clearance to "roadmap."**

Your own roadmap says the credential-vault story isn't safe to make public claims about
yet (`SEC-1` single-key encryption, `SEC-3` no tenant RLS, ADR-0003 default-deny not
flipped). Clearance levels are modeled but **not enforced** (PRODUCT §6). Show HN and
LinkedIn bring adversarial scrutiny at the worst possible moment for a security product.

So the launch claim is the thing that is **true, enforced, and defensible today**:

> **Sanction is a spend firewall for AI agents — per-agent budgets and an approval
> loop that actually halt the agent before the money moves, with every decision logged.**

This is exactly what your Show HN draft already leads with. Follow that instinct all the
way: pull the vault and clearance out of the *hero* and the *launch claims*, keep them as
"on the roadmap," and tighten the landing page to what the engine enforces. Trust is the
only thing a governance product sells; spend it carefully on day one.

**Two pre-launch fixes that protect the demo** (details in §7, scored in `BACKLOG.md`):
1. **Make escalation reachable on the default policy.** Today `perTxnMax $50` < `escalateOver $100`
   and the per-txn check runs first, so `status:"escalated"` can never fire out of the box —
   yet approve/**escalate**/deny *is* the pitch. Fix defaults + ordering.
2. **Tighten landing/claims to enforced behavior.** Demote vault + clearance, or add an honest
   "single-tenant today, per-tenant KMS in progress" note. Don't sell `autoApproveUnderUsd` /
   `allowedCategories` — neither is wired into `/authorize`.

---

## 1. The narrative — what it means to give an agent agency

This is the spine for HN, LinkedIn, and every founder post. It is *ownable* and true.

**The models can already act. What's missing is permission.** A coding agent can spin up
infra; a research agent can buy data; a shopping agent can check out. Capability arrived.
The layer that decides *whether it may, how much, and on whose authority* did not. That's
the gap.

**Agency is not capability — it's standing.** A person with agency has three things a
capable-but-ungoverned process doesn't:

| | What it answers | Sanction primitive |
|---|---|---|
| **Identity** | *Who is this agent, and who stands behind it?* | A scoped key = a verifiable, attributable name. Every call is traceable to an agent and an owner. |
| **Authority** | *What may it do, up to what limit, for how long?* | Policy: budgets, thresholds, categories, time-boxed scopes. Bounded, revocable permission. |
| **Accountability** | *What did it actually do, and can we prove it?* | An append-only decision + injection log. Every approve/escalate/deny on the record. |

**Sanction = identity + authority + accountability for agents.** The passport (who),
the visa (what it may do, time-boxed), and the customs log (what it did).

Lines that land:
- *"An agent without limits isn't autonomous — it's unsupervised."*
- *"Autonomy is permission, not capability. Sanction is the permission layer."*
- *"We don't give agents freedom. We give them standing — and the limits that make standing safe to grant."*
- *"Don't give your AI agent your credit card. Give it a Sanction."*

This narrative also future-proofs you: as ACP/AP2/x402 fragment the payment rails, the
durable position is the **neutral identity + authority + audit brain that sits in front of
whichever rail wins** (your MARKET §4 thesis). Identity is the long game; the spend
firewall is the wedge that gets you in the door this week.

---

## 2. Positioning recap (from POSITIONING.md, sharpened for launch)

- **Category to claim:** Layer 4, *pre-action authorization* — the youngest, least-crowded
  layer. Don't invent a category; plant a sharp flag in this one.
- **One-liner (launch):** *"A spend firewall for autonomous AI agents."* (Concrete, demoable,
  no over-claim.) Graduate to *"the authorization layer for agents that act"* as enforcement lands.
- **Avoid:** "Stripe for agents" (collides with Stripe ACP + implies custody you don't do),
  "Vault for agents" (HashiCorp/1Password/Infisical own the word).
- **Compliance-as-architecture is an asset:** you authorize + log, you don't custody funds →
  out of money-transmitter/PCI scope (ADR-0005). Say this to anyone who asks "are you a wallet?"

---

## 3. Launch sequencing — next week

**Recommendation: Option A — ship the budget-firewall launch this week, after a 1–2 day
claims-tightening + escalation-fix pass.** Momentum compounds; the cost wedge is honest and
real; you do not need the vault to be the story. (Option B = delay ~2 weeks to close `SEC-3`
+ ADR-0003 and launch the full secure-vault story. Higher-trust, slower. Take B only if a
design partner needs the vault now.)

**The week (full copy + checklist in `LAUNCH-WEEK.md`):**

| Day | Move | Why |
|---|---|---|
| **Mon** | Land the two pre-launch fixes (escalation-reachable defaults; tighten landing claims). Ship simulation/dry-run note. | The demo and the test kit have to "just work" before anyone runs them. |
| **Tue** | Soft launch: founder LinkedIn post #1 (the "agency = identity + authority + accountability" narrative) + X thread. Seed the story before the spike. | Warms the audience; LinkedIn rewards the narrative, HN rewards the artifact. |
| **Wed** | **Show HN** (title #1: *"Sanction – financial control for autonomous AI agents"*), early AM PT. Post the technical first-comment immediately. Be at the keyboard all day. | HN is won in the comments in the first 3 hours. |
| **Wed–Thu** | LinkedIn post #2 (a real overspend incident → "this is why"). Submit MCP Registry + Anthropic Connectors Directory. | Convert HN attention into the warm, durable channels. |
| **Fri** | Recap post (what HN taught you; the two questions you asked, answered). Line up Product Hunt for the *following* week. | Don't stack PH on HN — sequence them. |

**HN guardrails:** title #1 over #2 (the credit-card line is clickier but riskier on HN).
Lead the body with cost governance and *say it's early* (your draft does this — keep it).
Do **not** foreground the vault. Have the runnable Gemini example and the Test Kit ready —
HN will run them.

---

## 4. Channels & distribution map (tiered by effort:leverage)

Built on your `DIST-*` backlog; reordered for the launch window.

**Tier 1 — warm, owned, ship this week (MCP-native is your unfair advantage):**
- **MCP Registry `server.json`** (`DIST-1`, RICE 48.6) — highest leverage in the whole plan.
  Elite tool names/descriptions ("call BEFORE any spend; bypassing fails"). Fans out to every MCP host.
- **Anthropic Connectors / MCP Directory** (`DIST-4`) — curated, trafficked, and you're a
  natural fit (you're running inside Claude Code right now — dogfood it as the demo).
- **A2A AgentCard** (`DIST-2`, shipped) — keep it pointing at the live OpenAPI spec.

**Tier 2 — product/tech-stack integrations (the "into dev workflows" ask, §6):**
- **Vercel** — you're already hosted there. Ship a Vercel AI SDK middleware package + a
  Marketplace/Integrations listing + a deploy-template ("your own agent spend firewall").
  Vercel actively co-markets ecosystem integrations; this is the most underused channel you have.
- **Agent frameworks** — LangGraph, CrewAI, LlamaIndex, AutoGen, Mastra, Pydantic AI. A tiny
  `authorize()` callback/middleware per framework; get listed in each framework's integrations docs.
- **Coding agents** — Cursor, Cline, Continue, Windsurf, OpenHands, Devin. MCP plugin +
  marketplace listings. These agents *run paid commands* — your exact buyer.
- **AWS Bedrock AgentCore + Marketplace** (`DIST-5`) — you already have the action group; the
  AgentCore registry + AWS Marketplace listing is an enterprise surface few small teams reach.

**Tier 3 — communities & digital (top-of-funnel):**
- HN (launch), Product Hunt (week 2), MCP Discord, r/AI_Agents & r/LocalLLaMA, the x402/AP2
  builder communities, and the agent-builder newsletters (Latent Space, Ben's Bites, TLDR AI).
- SEO lane (`DIST-6`): own "agent spend limits," "stop runaway agent costs," "agent budget /
  approval loop." Proven intent pool; the incumbents don't write for the *builder*.

---

## 5. Partnerships — co-sell, integrate, ride-along

Frame every one of these as **"we're the policy/consent/audit brain; you keep your lane."**

- **Payment rails (co-sell, NOT compete):** Lithic, Stripe Issuing-for-agents, Coinbase x402.
  You gate the action; they move the money. x402's developer community is full of agent
  builders hungry for governance tooling — warmest first conversation.
- **Observability (integrate + co-market):** Langfuse (OSS, community-heavy → best first
  partner), Helicone, Arize. *"They tell you what an agent spent after the fact. Sanction
  decides before."* Import their cost data → enrich your budgets.
- **Identity (ride-along):** WorkOS (AuthKit-for-AI-agents, courts dev startups), Okta-for-AI-
  Agents, Microsoft Entra Agent ID. Be the spend + credential layer **on top of** their agent
  identity rather than fighting their IdP.
- **Design-partner #0:** AIIA. Already integrated — that's your proof and your case study.
  Productize the AUTO/SUPERVISED/GATED mapping onto policy as the reference architecture (`DIST-3`).

---

## 6. Outside-the-box — moving Sanction *into* dev workflows

The strategic unlock: **stop being an external dashboard; become part of the repo and the
pipeline.** Developers adopt what lives where they already work.

1. **`sanction.yaml` policy-as-code.** Budgets, categories, thresholds, clearance committed
   next to the code — like `CODEOWNERS` or a Dependabot config for agent spend. The policy
   lives in the repo, reviewed in PRs. This is the single highest-conviction wedge into dev
   workflows: it makes Sanction a *file developers own*, not a SaaS they log into.
2. **Sanction as a CI gate / GitHub Action.** Coding agents (Claude Code, Devin, Cursor
   background agents, OpenHands) increasingly run in CI and provision paid infra. A
   `sanction-action` authorizes spend and posts approve/deny as a **PR check**:
   *"Your coding agent tried to provision a $400/mo RDS — Sanction blocked it; audit row attached."*
3. **`npx sanction run -- <command>`.** A CLI wrapper that meters and gates any agent
   subprocess's spend with zero code changes. Lowest-friction possible adoption.
4. **Framework middleware.** Vercel AI SDK middleware + LangGraph/CrewAI/Mastra/Pydantic-AI
   callbacks that wrap tool calls in an `authorize()` check. Distribution rides the frameworks.
5. **Dogfood Claude Code now (and film it).** You're inside Claude Code today. Give it a $20
   budget and a spend firewall via the Sanction MCP, then record the session: *"I gave a coding
   agent a credit limit — here's what happened when it hit the cap."* That's the demo *and* the
   LinkedIn post.
6. **The "Agent Spend Incidents" tracker.** A public, growing list of real runaway-agent bill
   stories (the $X surprise invoices people post). Each entry is a reason-to-believe, a LinkedIn
   post, and category-defining SEO. Turns the market's pain into your content engine.
7. **Spend-firewall egress proxy.** A drop-in proxy that intercepts outbound paid-API calls and
   runs `authorize()` — governs agents you can't even modify.

Items 1–3 are the strongest "dev-workflow" bets; 5 is free and you can do it this week.

---

## 7. Product validation

**The validation question that matters:** *"Will a developer put Sanction in the critical
path of a money-spending agent?"* That requires three things at once — trust (security gates),
near-zero friction (simulation mode + an SDK), and felt pain (a real overspend story).

**Plan:**
- **Get 3–5 design partners.** Sources, in order: AIIA (done — it's #1), people who reply "I
  need this" to the HN/LinkedIn launch, the x402/MCP builder communities, indie agent startups.
- **Ship the Agent Test Kit to agents *and* humans.** You already wrote an excellent one
  (`SANCTION-AGENT-TEST-KIT.md`) — clever to have AI agents test the agent-governance product.
  Collect the structured reports; they *are* your validation data.
- **Instrument activation.** Time-to-first-authorized-call; % who set a non-default policy; %
  who run a *real* (non-simulated) authorize. Define the aha moment explicitly:
  **the first time Sanction stops a real overspend.**

**Pre-launch product fixes surfaced by validation (scored in `BACKLOG.md`):**
- **`GTM-1` Escalation reachable on defaults.** Default `perTxnMax $50` < `escalateOver $100`
  and per-txn is checked first → escalate never fires out of the box (Test Kit B5). Fix the
  default ladder so `autoApprove ≤ escalateOver ≤ perTxnMax` and the three-outcome demo works
  cold. Highest-leverage, lowest-effort fix before HN runs your kit.
- **`GTM-2` Wire or drop `autoApproveUnderUsd` + `allowedCategories`.** Both are in the schema
  and the marketing but unused in `/authorize`. Either enforce them or stop selling them —
  on a security product the gap *is* the story if someone finds it.
- **`UX-2` Escalation timeout fallback** (already in backlog) — your Test Kit B5/B8 shows the
  approval loop is the #1 reliability gap. Don't demo "escalate" without a resolution path.

---

## 8. What success looks like (first 30 / 90 days)

**30 days (launch + learn):**
- Show HN front-page-adjacent with a substantive comment thread (the *feedback*, not just votes,
  is the win — you asked two sharp questions; harvest the answers).
- MCP Registry + Anthropic Connectors live. 1 framework integration shipped.
- 3–5 design partners running real authorize calls; ≥1 documented "Sanction stopped a real overspend."
- The narrative (identity + authority + accountability) showing up in *other people's* words.

**90 days (wedge → product):**
- `sanction.yaml` + GitHub Action shipped — Sanction is in a CI pipeline somewhere that isn't yours.
- Escalation loop (`UX-2`) and one co-sell rail partner (x402 or Lithic) in motion.
- Security gates `SEC-1`/`SEC-3` + ADR-0003 closed → *now* you can lead with the vault and add
  "programmable governance for agent actions" to the story.
- First inbound from a security/identity incumbent or an agent platform wanting to integrate —
  the signal that you've planted the Layer-4 flag before they did.

**The clock (ROADMAP §"the clock you're racing"):** AgentCore vaults credentials, Stripe owns
rails, Okta/WorkOS/Entra race into agent identity. Your defensible ground is **cross-platform +
developer-first + the identity/authority/audit brain no single platform owns.** Move on the
wedge now while it's open.
</content>
</invoke>
