// Tool-invocation rules (ADR-0009 M3) — the first non-money action through the
// policy decision engine. "Can this agent invoke this MCP tool?" governed the
// same way spend is: block-list, allow-list, escalate-list. Pure over context.

import { allow, type Rule } from "@/lib/evaluation"

// COND-1: a conditional restriction — closed vocabulary, one predicate per
// rule. `when` names the condition under which the restriction is ACTIVE.
// Effects are restrictive only (block/escalate); allow stays unconditional
// membership so the allow-list semantics never depend on a clock or counter.
export type ToolConditionRule = {
  pattern: string
  effect: "block" | "escalate"
  when: {
    /** Active OUTSIDE [start, end) UTC hours; [22, 6] wraps midnight. */
    outside_hours_utc?: [number, number]
    /** Active once the agent's persisted model calls today reach N. */
    after_model_calls_today?: number
  }
}

/** Prefix-glob, same matcher contract as capability rules. */
function toolMatches(pattern: string, tool: string): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith("*")) return tool.startsWith(pattern.slice(0, -1))
  return tool === pattern
}

export type ToolContext = {
  tool: string
  blockedTools: string[]
  allowedTools: string[]
  escalateTools: string[]
  // COND-1 — all optional so pre-COND stored contexts replay unchanged.
  conditions?: ToolConditionRule[]
  /** Wall-clock UTC hour of the request, supplied ONCE by the shell — rules
   * never read the live clock, or evidence replay would drift. */
  requestHourUtc?: number
  /** The agent's persisted model calls (token logs) today, shell-supplied. */
  modelCallsToday?: number
}

/** True when the condition holds. A rule whose SIGNAL is absent from the
 * context is inactive (pre-COND rows, simulation over old history) — the
 * skip is deterministic because it depends only on the stored context. */
function conditionActive(rule: ToolConditionRule, c: ToolContext): boolean {
  const w = rule.when
  if (w.outside_hours_utc) {
    if (c.requestHourUtc === undefined) return false
    const [start, end] = w.outside_hours_utc
    const inside = start < end
      ? c.requestHourUtc >= start && c.requestHourUtc < end
      : c.requestHourUtc >= start || c.requestHourUtc < end // wraps midnight
    return !inside
  }
  if (w.after_model_calls_today !== undefined) {
    if (c.modelCallsToday === undefined) return false
    return c.modelCallsToday >= w.after_model_calls_today
  }
  return false
}

function conditionLabel(rule: ToolConditionRule, c: ToolContext): string {
  if (rule.when.outside_hours_utc) {
    const [s, e] = rule.when.outside_hours_utc
    return `outside ${String(s).padStart(2, "0")}–${String(e).padStart(2, "0")} UTC`
  }
  return `after ${rule.when.after_model_calls_today} model calls today (${c.modelCallsToday} so far)`
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

export const toolConditionBlockRule: Rule<ToolContext> = {
  id: "tool_condition_block",
  run(c) {
    const hit = (c.conditions ?? []).find((r) => r.effect === "block" && toolMatches(r.pattern, c.tool) && conditionActive(r, c))
    if (hit) {
      return {
        effect: "deny",
        ruleId: "tool_condition_block",
        code: "TOOL_CONDITION_BLOCKED",
        reason: `Tool '${c.tool}' is blocked ${conditionLabel(hit, c)} (${hit.pattern})`,
      }
    }
    return allow("tool_condition_block")
  },
}

export const toolConditionEscalateRule: Rule<ToolContext> = {
  id: "tool_condition_escalate",
  run(c) {
    const hit = (c.conditions ?? []).find((r) => r.effect === "escalate" && toolMatches(r.pattern, c.tool) && conditionActive(r, c))
    if (hit) {
      return {
        effect: "escalate",
        ruleId: "tool_condition_escalate",
        code: "TOOL_CONDITION_ESCALATION_REQUIRED",
        reason: `Tool '${c.tool}' requires human approval ${conditionLabel(hit, c)} (${hit.pattern})`,
      }
    }
    return allow("tool_condition_escalate")
  },
}

// Precedence (deny-overrides): blocked → conditional block → allow-list →
// escalate → conditional escalate → allow.
export const TOOL_RULES: Rule<ToolContext>[] = [
  toolBlockRule,
  toolConditionBlockRule,
  toolAllowlistRule,
  toolEscalateRule,
  toolConditionEscalateRule,
]
