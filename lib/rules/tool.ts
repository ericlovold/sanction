// Tool-invocation rules (ADR-0009 M3) — the first non-money action through the
// policy decision engine. "Can this agent invoke this MCP tool?" governed the
// same way spend is: block-list, allow-list, escalate-list. Pure over context.

import { allow, type Rule } from "@/lib/evaluation"

export type ToolContext = {
  tool: string
  blockedTools: string[]
  allowedTools: string[]
  escalateTools: string[]
}

export const toolBlockRule: Rule<ToolContext> = {
  id: "tool_block",
  run(c) {
    if (c.blockedTools.includes(c.tool)) {
      return { effect: "deny", ruleId: "tool_block", code: "TOOL_BLOCKED", reason: `Tool '${c.tool}' is blocked` }
    }
    return allow("tool_block")
  },
}

export const toolAllowlistRule: Rule<ToolContext> = {
  id: "tool_allowlist",
  run(c) {
    // Empty allow-list = allow all (governance is opt-in for tools).
    if (c.allowedTools.length > 0 && !c.allowedTools.includes(c.tool)) {
      return { effect: "deny", ruleId: "tool_allowlist", code: "TOOL_NOT_ALLOWED", reason: `Tool '${c.tool}' is not in the allow-list` }
    }
    return allow("tool_allowlist")
  },
}

export const toolEscalateRule: Rule<ToolContext> = {
  id: "tool_escalate",
  run(c) {
    if (c.escalateTools.includes(c.tool)) {
      return { effect: "escalate", ruleId: "tool_escalate", code: "TOOL_ESCALATION_REQUIRED", reason: `Tool '${c.tool}' requires human approval` }
    }
    return allow("tool_escalate")
  },
}

// Precedence (deny-overrides): blocked → allow-list → escalate → allow.
export const TOOL_RULES: Rule<ToolContext>[] = [toolBlockRule, toolAllowlistRule, toolEscalateRule]
