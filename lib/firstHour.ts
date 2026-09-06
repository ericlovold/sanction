// First-hour continuity: the three clicks after /start. Pure over wallet
// signals so the roster checklist and Approvals empty state cannot drift,
// and so we can unit-test the honesty rules without rendering the console.
//
// Honesty: do not claim tool/capability governance unless the policy matches
// the coding-agent pack's distinctive fields. Empty allowedTools is allow-all
// (opt-in). Hosted MCP is cooperative; the broker intercepts tools/call.

export const CODING_AGENT_STARTER_READS = [
  "github.get_file_contents",
  "filesystem.read_file",
  "filesystem.list_directory",
] as const

export const CODING_AGENT_SHELL_DENY = "shell.exec"

export type FirstHourSignals = {
  hasAgent: boolean
  /** Any persisted authorization — TestDecision on /start, a live agent, or a test escalation. */
  hasDecision: boolean
  hasSlack: boolean
  hasWebhook: boolean
  hasGatewayUsage: boolean
  codingAgentPackApplied: boolean
}

export type FirstHourLink = { href: string; label: string }

export type FirstHourStep = {
  id: "decision" | "channel" | "policy"
  title: string
  hint: string
  done: boolean
  href: string
  links: FirstHourLink[]
}

export type CodingAgentPolicyShape = {
  allowedTools: string[]
  blockedTools: string[]
  capabilityRules: unknown
}

function capabilityPatterns(rules: unknown): string[] {
  if (!Array.isArray(rules)) return []
  const out: string[] = []
  for (const row of rules) {
    if (!row || typeof row !== "object") continue
    const pattern = (row as { pattern?: unknown }).pattern
    if (typeof pattern === "string" && pattern.trim()) out.push(pattern.trim())
  }
  return out
}

/** Distinctive coding-agent-seat posture — not the default empty tool/capability lists. */
export function looksLikeCodingAgentPack(policy: CodingAgentPolicyShape): boolean {
  const allowed = new Set(policy.allowedTools)
  if (!CODING_AGENT_STARTER_READS.every((name) => allowed.has(name))) return false
  if (!policy.blockedTools.includes(CODING_AGENT_SHELL_DENY)) return false
  const patterns = new Set(capabilityPatterns(policy.capabilityRules))
  return patterns.has("skill:install:*") && patterns.has("plugin:*") && patterns.has("mcp:add:*") && patterns.has("*")
}

export function firstHourComplete(signals: FirstHourSignals): boolean {
  return signals.hasDecision && (signals.hasSlack || signals.hasWebhook || signals.hasGatewayUsage) && signals.codingAgentPackApplied
}

/** Session wallets that have not finished the three clicks. Demo view keeps the tour. */
export function shouldShowFirstHourChecklist(signals: FirstHourSignals, view: { isSession: boolean; isDemo: boolean }): boolean {
  if (!view.isSession || view.isDemo) return false
  return !firstHourComplete(signals)
}

export function firstHourSteps(signals: FirstHourSignals): FirstHourStep[] {
  const channelDone = signals.hasSlack || signals.hasWebhook || signals.hasGatewayUsage

  return [
    {
      id: "decision",
      title: "See a decision",
      hint: signals.hasDecision
        ? "A real decision is on the record. Open Approvals to decide anything still waiting, or send another test escalation."
        : signals.hasAgent
          ? "Send a test escalation — a real $30 pause that emails you and lands in Approvals. On /start you can also run a $5 / $40 purchase."
          : "Add an agent on this roster first. The test escalation is raised by one of your agents.",
      done: signals.hasDecision,
      href: signals.hasAgent ? "/dashboard/approvals#test-escalation" : "/dashboard",
      links: signals.hasAgent
        ? [{ href: "/dashboard/approvals#test-escalation", label: "Send a test escalation" }]
        : [],
    },
    {
      id: "channel",
      title: "Connect Slack, the gateway, or MCP",
      hint: channelDone
        ? "A channel is connected. Hosted MCP stays cooperative — the host must ask. The broker intercepts tools/call if you front an upstream."
        : "Slack and email deliver the same approval. The LLM gateway meters model calls. Hosted MCP is cooperative — the host must ask; the broker intercepts tools/call.",
      done: channelDone,
      href: "/dashboard/approvals",
      links: [
        { href: "/dashboard/approvals", label: "Slack & notifications" },
        { href: "/docs/gateway", label: "Gateway" },
        { href: "/docs/agent-wallet", label: "Hosted MCP" },
      ],
    },
    {
      id: "policy",
      title: signals.codingAgentPackApplied ? "Coding-agent pack is on" : "Apply the coding-agent pack",
      hint: signals.codingAgentPackApplied
        ? "New capability asks first. Match the exact tool names to your host before you rely on the allow-list. Applying a pack replaces those fields — it is not a silent merge."
        : "Default policy is spend-only; tool lists are empty (allow-all) and capability is opt-in. Apply Coding agent seat on Policy to escalate new skills, plugins, and MCP adds. Review first — apply overwrites those fields.",
      done: signals.codingAgentPackApplied,
      href: "/dashboard/policy",
      links: [
        { href: "/dashboard/policy", label: "Policy packs" },
        { href: "/docs/capability-governance", label: "Capability walkthrough" },
      ],
    },
  ]
}

export function approvalsEmptyCopy(opts: { hasAgent: boolean; editable: boolean }): { title: string; hint: string } {
  if (!opts.editable) {
    return {
      title: "Nothing waiting",
      hint: "When an agent's request crosses the escalation line it lands here. Log in as an admin to send a test escalation and see the email loop.",
    }
  }
  if (!opts.hasAgent) {
    return {
      title: "Nothing waiting",
      hint: "Add an agent on the roster first. The test escalation is raised by one of your agents — then it emails you and lands here.",
    }
  }
  return {
    title: "Nothing waiting",
    hint: "When an agent's request crosses the escalation line it lands here, and the agent waits. Send a test escalation to see the email and this inbox — Slack is optional.",
  }
}
