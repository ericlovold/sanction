import fs from "node:fs"
import path from "node:path"

// On-site docs rendered from the repo's markdown guides. Server-only (reads fs).
// Only public-facing guides are listed here.
export const DOCS: Record<string, { file: string; title: string; description: string }> = {
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
  "multi-tenant": {
    file: "INTEGRATION.md",
    title: "Multi-Tenant Integration Runbook",
    description:
      "Provision an agent per tenant, govern budgets centrally, meter LLM calls through the gateway, and rotate keys — the end-to-end runbook for platforms.",
  },
}

export function readDoc(slug: string) {
  const meta = DOCS[slug]
  if (!meta) return null
  const md = fs.readFileSync(path.join(process.cwd(), "docs", meta.file), "utf8")
  return { ...meta, md }
}
