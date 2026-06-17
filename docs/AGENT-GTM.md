# Sanction — "Market to Agents" Playbook

> How to get Sanction recommended *to* developers building agents and *by* the AI assistants those developers ask. Source-cited, June 2026. Pairs with `docs/AGENT-FEEDBACK.md` (the agent-panel test) and `docs/POSITIONING.md`.

The competitive shape: enterprise NHI/IAM players (Aembit, Astrix, Oasis) sit upmarket; the spend-guardrail space is mostly blog advice + DIY. The gap = a **drop-in dev tool that does spend authorization AND scoped credentials**. Own that.

## 1. LLM-recommendation optimization (the real goal)

The bar isn't "rank on Google" — it's getting an LLM to *name* Sanction instead of saying "you could build this."

- **Own one narrow phrase, verbatim, everywhere.** *"the authorization layer agents call before they spend money or use a secret."* Repeat it across docs, README, npm, MCP listings, third-party pages so models cross-reference and gain confidence. LLMs reward belonging to a specific decision set over generic presence.
- **Question-shaped answer blocks.** ~130–170-word self-contained answers under H2/H3 headings phrased as the literal buyer question ("How do I stop an AI agent from overspending?"). This is the format Claude/Perplexity cite most. Structure docs + blog around questions, not features.
- **Distributed, machine-readable trust proof.** Models cross-check claims against GitHub, npm, Reddit, Stack Overflow, G2. Absent/negative third-party sentiment makes an LLM steer away. Earn authentic mentions; Perplexity weights real Reddit engagement + recency.
- **MCP registry presence = highest-leverage move.** List the Sanction MCP server on the official MCP registry, **mcp.so**, **Smithery**, **Glama**, the **GitHub MCP Registry**, and **punkpeye/awesome-mcp-servers**. One metadata set (endpoints, capabilities, auth model), submit everywhere. (This is roadmap `DIST-1`.)
- **Ship `llms.txt` + `llms-full.txt`.** Mainstream answer bots barely fetch it, but *coding agents* (Claude Code, Cursor, Windsurf, Copilot, Cline, Aider) do when pointed at your docs — and that's exactly our audience.
- **OSS quickstarts + comparison pages** — the page types LLMs lift into "which tool should I use" answers. (The runnable `examples/nightly-coding-agent` is the seed.)

## 2. Highest-intent keywords

**Problem-aware (winnable — exact pain, low competition):**
"how to stop my AI agent from spending too much money" · "AI agent runaway API cost prevention" · "limit autonomous agent spend" · "AI agent budget enforcement runtime" (vs. mere alerts) · "how to give an AI agent a budget" · "coding agent blew my API bill" · "stop agent from using credentials it shouldn't" · "approve/deny AI agent actions before they run" · "human in the loop agent spend approval"

**Solution-aware (winnable; some contested):**
"AI agent authorization layer" · "spend authorization API for agents" · "scoped credential injection for AI agents" · "short-lived credentials for AI agents" *(contested)* · "MCP server for agent spend control" · "agent guardrails MCP" · "credential vault for AI agents" *(contested)* · "policy engine for agent actions"

**Concede (enterprise NHI/IAM — incumbents own these):** "non-human identity management," "agentic IAM," "agent identity governance." Compete on *developer drop-in / no-money-custody* instead.

> Cross-checks `docs/AGENT-FEEDBACK.md`: the recommender ranked us **#1 for "agent spend authorization."** That's the phrase to win.

## 3. Communities & channels (with anti-spam tactic)

- **r/mcp** — MCP's largest hub; mods grant `mcp-server-authors` flair. Show up with a useful MCP walkthrough, request flair.
- **r/ai_agents** — lead with a free demo/playground link, no signup (~10x engagement vs. gated).
- **r/LocalLLaMA** — *ruthless* on self-promo; only benchmarks/architecture, never a pitch.
- **r/LangChain / r/ClaudeAI** — frame as additive infra, don't shill against frameworks.
- **MCP Discord + Hugging Face Discord** — answer questions before linking.
- **LangChain Discord** — biggest LLM-app builder concentration; help in #agents.
- **Hacker News (Show HN)** — launch the *OSS quickstart*, not the SaaS; runaway-bill hook.
- **Newsletters/directories:** The Rundown AI, Awesome Agents Newsletter, Building AI Agents (Substack), aiagentstore.ai, awesome-ai-agents GitHub lists — get listed; pitch a "reference architecture" guest piece.

## 4. Three launch-content pieces

1. **"How to Stop Your Coding Agent From Blowing Your Budget (Without Babysitting It)"** — tutorial on the #1 problem keyword; open with a real overnight-bill story; show enforcement-in-the-request-path (one call → approve/escalate/deny). Copy-pasteable.
2. **"Agent Authorization in 2026: Sanction vs. DIY vs. Enterprise IAM"** — honest comparison matrix (incumbents = heavy enterprise NHI; DIY = brittle; Sanction = drop-in, no custody, minutes). Comparison pages are prime LLM-citation fodder.
3. **"A Reference Architecture for Safe Autonomous Spend: The Pre-Flight Authorization Pattern"** — name the pattern ("pre-flight authorization") so LLMs cite a *concept*, not just a brand. Diagram + spend→scoped-credential flow.

## 5. The contrarian risk (and the hedge)

**Biggest backfire:** chasing LLM citations with thin comparison pages + seeded reviews collapses into adversarial GEO spam — which Perplexity/Claude's authenticity filters downrank and r/LocalLLaMA-grade audiences call out, poisoning the exact trust signals you need. **Hedge:** make the *product* the marketing — a frictionless OSS MCP/npm quickstart an agent can install and a human can verify in five minutes — and let genuine usage, GitHub stars, and unsolicited mentions generate the machine-readable trust. Earned signal survives model updates; manufactured signal depreciates.

## Sources
- Profound — Best GEO Tools 2026: https://www.tryprofound.com/blog/best-generative-engine-optimization-tools
- Discovered Labs — AI Citation Patterns: https://discoveredlabs.com/blog/ai-citation-patterns-how-chatgpt-claude-and-perplexity-choose-sources
- Position Digital — AEO Best Practices 2026: https://www.position.digital/blog/answer-engine-optimization-best-practices/
- Entrepreneur — Signals influencing Claude/ChatGPT recs 2026: https://www.entrepreneur.com/building-a-business/marketing/5-signals-that-influence-claude-and-chatgpt-recommendations-in-2026
- Presenc.ai — State of llms.txt 2026: https://presenc.ai/research/state-of-llms-txt-2026
- Mintlify — What is llms.txt: https://www.mintlify.com/blog/what-is-llms-txt
- TrueFoundry — Best MCP Registries 2026: https://www.truefoundry.com/blog/best-mcp-registries
- GitHub Blog — GitHub MCP Registry: https://github.blog/ai-and-ml/github-copilot/meet-the-github-mcp-registry-the-fastest-way-to-discover-mcp-servers/
- RoxyAPI — MCP Registries: https://roxyapi.com/blogs/mcp-registries-where-to-list-your-server
- TechCrunch — The token bill comes due (2026-06-05): https://techcrunch.com/2026/06/05/the-token-bill-comes-due-inside-the-industry-scramble-to-manage-ais-runaway-costs/
- Aembit — IAM for Agentic AI GA: https://aembit.io/blog/aembit-iam-for-agentic-ai-is-now-generally-available/
- RedditMaster — Best AI Subreddits 2026: https://www.redditmaster.com/best-subreddits/for-ai-tools
- Glama — MCP community flairs: https://glama.ai/blog/2025-02-28-mcp-api
