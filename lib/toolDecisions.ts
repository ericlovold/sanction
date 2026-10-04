import type { DecisionCode } from "@/lib/decisions"
import { evaluate } from "@/lib/evaluation"
import { TOOL_RULES, type ToolContext } from "@/lib/rules/tool"

// Typed decision codes for /authorize/tool (parallels lib/decisions.ts for spend).
// A stable code + remediation lets an agent replan on a tool denial.

export type ToolDecisionCode = "TOOL_BLOCKED" | "TOOL_NOT_ALLOWED" | "TOOL_ESCALATION_REQUIRED" | "TOOL_CONDITION_BLOCKED" | "TOOL_CONDITION_ESCALATION_REQUIRED"

export const TOOL_REMEDIATION: Record<ToolDecisionCode, string> = {
  TOOL_BLOCKED: "This tool is on the wallet's blocked list. Use an allowed tool or ask the owner to unblock it.",
  TOOL_NOT_ALLOWED: "This tool is not on the wallet's allow-list. Ask the owner to add it, or use an allowed tool.",
  TOOL_ESCALATION_REQUIRED: "This tool requires human approval. Wait for human review, then check the request status once.",
  TOOL_CONDITION_BLOCKED:
    "A conditional rule blocks this tool right now (time window or usage threshold). Retry when the condition clears, or ask the owner to adjust it.",
  TOOL_CONDITION_ESCALATION_REQUIRED:
    "A conditional rule requires human approval right now (time window or usage threshold). Wait for human review, then check the request status once.",
}

// Failed tool-grant redemption is terminal; recovery requires owner review.
// Keep spend/provision remediation unchanged on their respective endpoints.
export const TOOL_GRANT_REMEDIATION: Partial<Record<DecisionCode, string>> = {
  GRANT_NOT_FOUND: "Stop. No usable grant is available for this request. Report this result to the user; do not retry or automatically request another approval.",
  GRANT_EXPIRED: "Stop. This grant has expired. Report this result to the user; do not retry or automatically request another approval.",
  GRANT_MISMATCH: "Stop. This grant does not authorize these tool, server, and argument values. Report this result to the user; do not retry or automatically request another approval.",
}

export type ToolStatus = "allowed" | "escalated" | "denied"

export type ToolDecision = { status: ToolStatus; code?: ToolDecisionCode; reason?: string }

/** Decide a tool invocation through the engine and map to the API shape. */
export function decideTool(ctx: ToolContext): ToolDecision {
  const d = evaluate(ctx, TOOL_RULES)
  const status: ToolStatus = d.effect === "allow" ? "allowed" : d.effect === "escalate" ? "escalated" : "denied"
  return { status, code: d.code as ToolDecisionCode | undefined, reason: d.reason }
}
