import fs from "node:fs"
import path from "node:path"

// On-site docs rendered from the repo's markdown guides. Server-only (reads fs).
// Only public-facing guides are listed here.
export const DOCS: Record<string, { file: string; title: string; description: string }> = {
  authorization: {
    file: "CONCEPTS-AUTHORIZATION.md",
    title: "Authorization: the decision",
    description:
      "The mental model: wallets, agents, policy, the ladder, grants — and the invariants (fail closed, atomic, one-use authority) that make the decision trustworthy.",
  },
  "evidence-and-replay": {
    file: "CONCEPTS-EVIDENCE.md",
    title: "Evidence & replay",
    description:
      "Why every decision can prove itself: pure rules, immutable policy revisions, stored contexts, replay with a match verdict — and simulation over real history.",
  },
  "capability-governance": {
    file: "CONCEPTS-CAPABILITY.md",
    title: "Capability governance",
    description:
      "New skills, plugins, and APIs are governed like money: one ordered rule list, block → allow-list → escalate precedence, the same approval inbox and one-use grants.",
  },
  compatibility: {
    file: "COMPATIBILITY.md",
    title: "Compatibility & badges",
    description:
      "Badges and channel paths for MCP hosts, frameworks, gateways, and payment-agent pilots — with the exact Sanction surface each claim rests on.",
  },
  "framework-adapters": {
    file: "FRAMEWORK-ADAPTERS.md",
    title: "Framework adapters",
    description:
      "SanctionMiddleware, LangChain/LangGraph wrappers, and LiteLLM callback recipes for putting authorization before framework tool execution.",
  },
  quickstart: {
    file: "QUICKSTART.md",
    title: "Quickstart",
    description:
      "Create a wallet, issue an agent key, route an LLM call through the gateway, and authorize a spend — your first metered, governed call in under five minutes.",
  },
  "ai-sdk": {
    file: "VERCEL-AI-SDK.md",
    title: "Sanction + Vercel AI SDK",
    description:
      "Route AI SDK calls through Sanction with two lines of config — meter every token and cap spend across providers, per agent, per tenant.",
  },
  langchain: {
    file: "LANGCHAIN.md",
    title: "Sanction + LangChain",
    description:
      "Point LangChain's provider classes at the Sanction gateway to meter and cap every call, and add a pre-spend authorization check before your agent acts.",
  },
  "agent-fleets": {
    file: "AGENT-FLEETS.md",
    title: "Sanction for agent fleets",
    description:
      "Govern a fleet of spending agents: channels as delegated pools, seats as agent keys, budget envelopes with escalation, native cost-per-outcome ceilings, the freeze kill-switch, and chargeback rollups.",
  },
  bedrock: {
    file: "BEDROCK.md",
    title: "Sanction + AWS Bedrock Agents",
    description:
      "Expose Sanction's authorization operations to a Bedrock Agent as an Action Group — schema subset, forwarder Lambda, key custody, and the first governed decision in ten minutes.",
  },
  crewai: {
    file: "CREWAI.md",
    title: "Sanction + CrewAI",
    description:
      "Route CrewAI agents through the Sanction gateway and give the crew an authorize tool it must clear before any spend.",
  },
  "starter-kit": {
    file: "STARTER-KIT.md",
    title: "Agent-platform starter kit",
    description:
      "One recipe for any agent builder: before spend, tools, credentials, or provisioning, ask Sanction — act on approved, wait for the grant on escalated, stop clean on denied. REST, MCP, and webhooks.",
  },
  "authorize-then-act": {
    file: "AUTHORIZE-THEN-ACT.md",
    title: "Authorize, then act",
    description:
      "How third-party agent instructions enter this codebase: the review procedure we ran on a friend's skill pack before letting it steer our sessions. Steal it for your own repos.",
  },
  notifications: {
    file: "NOTIFICATIONS.md",
    title: "Approvals that find you",
    description:
      "Escalations and budget alerts, delivered where humans are: email by default, Slack with one pasted URL, signed webhooks for your own systems — with per-channel event routing.",
  },
  authzen: {
    file: "AUTHZEN.md",
    title: "Sanction as an AuthZEN PDP",
    description:
      "Point any OpenID AuthZEN 1.0 enforcement point at Sanction as its policy decision point — standard subject/action/resource in, decision out, mapped onto the same ladders as the native API.",
  },
  "multi-tenant": {
    file: "INTEGRATION.md",
    title: "Multi-Tenant Integration Runbook",
    description:
      "Provision an agent per tenant, govern budgets centrally, meter LLM calls through the gateway, and rotate keys — the end-to-end runbook for platforms.",
  },
  "commercial-license": {
    file: "COMMERCIAL-LICENSE.md",
    title: "Commercial License",
    description:
      "When the FSL covers your use, when you need a commercial license, and what enterprise agreements include — for procurement, legal, and partners.",
  },
}

export function readDoc(slug: string) {
  const meta = DOCS[slug]
  if (!meta) return null
  const md = fs.readFileSync(path.join(process.cwd(), "docs", meta.file), "utf8")
  return { ...meta, md }
}
