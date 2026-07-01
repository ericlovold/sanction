import { evaluate } from "@/lib/evaluation"
import { TOOL_RULES, type ToolContext } from "@/lib/rules/tool"

// Typed decision codes for /authorize/tool (parallels lib/decisions.ts for spend).
// A stable code + remediation lets an agent replan on a tool denial.

export type ToolDecisionCode = "TOOL_BLOCKED" | "TOOL_NOT_ALLOWED" | "TOOL_ESCALATION_REQUIRED"

export const TOOL_REMEDIATION: Record<ToolDecisionCode, string> = {
  TOOL_BLOCKED: "This tool is on the wallet's blocked list. Use an allowed tool or ask the owner to unblock it.",
  TOOL_NOT_ALLOWED: "This tool is not on the wallet's allow-list. Ask the owner to add it, or use an allowed tool.",
  TOOL_ESCALATION_REQUIRED: "This tool requires human approval. Poll for status, or wait for the owner to approve.",
}

export type ToolStatus = "allowed" | "escalated" | "denied"

export type ToolDecision = { status: ToolStatus; code?: ToolDecisionCode; reason?: string }

/** Decide a tool invocation through the engine and map to the API shape. */
export function decideTool(ctx: ToolContext): ToolDecision {
  const d = evaluate(ctx, TOOL_RULES)
  const status: ToolStatus = d.effect === "allow" ? "allowed" : d.effect === "escalate" ? "escalated" : "denied"
  return { status, code: d.code as ToolDecisionCode | undefined, reason: d.reason }
}
