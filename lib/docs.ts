import fs from "node:fs"
import path from "node:path"

// On-site docs rendered from the repo's markdown guides. Server-only (reads fs).
// Only public-facing guides are listed here.
export const DOCS: Record<string, { file: string; title: string; description: string }> = {
  "multi-tenant": {
    file: "INTEGRATION.md",
    title: "Multi-Tenant Integration Runbook",
    description:
      "Provision an agent per tenant, govern budgets centrally, meter LLM calls through the gateway, and rotate keys — the end-to-end runbook for platforms.",
  },
  "ai-sdk": {
    file: "VERCEL-AI-SDK.md",
    title: "Sanction + Vercel AI SDK",
    description:
      "Route AI SDK calls through Sanction with two lines of config — meter every token and cap spend across providers, per agent, per tenant.",
  },
}

export function readDoc(slug: string) {
  const meta = DOCS[slug]
  if (!meta) return null
  const md = fs.readFileSync(path.join(process.cwd(), "docs", meta.file), "utf8")
  return { ...meta, md }
}
