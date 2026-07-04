import { allow, evaluate, type Rule } from "@/lib/evaluation"

// Capability governance (CAP-1): installing a skill, adding a plugin, calling
// a new API — acquiring capability is a governed action like spending money.
// One ordered rule list, namespaced ids, prefix-glob matching, the same
// block → allow-list → escalate precedence as the tool ladder. Rules stay
// pure over their context (ADR-0009); the routes are the enforcement shell.

export type CapabilityEffect = "block" | "allow" | "escalate"
export type CapabilityRule = { pattern: string; effect: CapabilityEffect }

export type CapabilityContext = {
  capability: string // namespaced, e.g. "skill:install:web-scraper", "api:github.com/repos"
  rules: CapabilityRule[]
}

/** Parse a Policy.capabilityRules Json column into validated rules (bad entries dropped). */
export function parseCapabilityRules(value: unknown): CapabilityRule[] {
  if (!Array.isArray(value)) return []
  const out: CapabilityRule[] = []
  for (const v of value) {
    if (
      v && typeof v === "object" &&
      typeof (v as CapabilityRule).pattern === "string" && (v as CapabilityRule).pattern.length > 0 &&
      ["block", "allow", "escalate"].includes((v as CapabilityRule).effect)
    ) {
      out.push({ pattern: (v as CapabilityRule).pattern, effect: (v as CapabilityRule).effect })
    }
  }
  return out
}

/** Prefix-glob match: exact, or a trailing '*' matches any suffix. */
export function capabilityMatches(pattern: string, capability: string): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith("*")) return capability.startsWith(pattern.slice(0, -1))
  return capability === pattern
}

const blockRule: Rule<CapabilityContext> = {
  id: "capability_block",
  run(c) {
    const hit = c.rules.find((r) => r.effect === "block" && capabilityMatches(r.pattern, c.capability))
    if (hit) {
      return { effect: "deny", ruleId: "capability_block", code: "CAPABILITY_BLOCKED", reason: `Capability '${c.capability}' is blocked (${hit.pattern})` }
    }
    return allow("capability_block")
  },
}

const allowlistRule: Rule<CapabilityContext> = {
  id: "capability_allowlist",
  run(c) {
    // Governance is opt-in: no allow rules = allow all (block/escalate still
    // apply). When allow rules exist, any EXPLICIT mention satisfies the list —
    // an escalate pattern is a mention, so escalate-listed capabilities reach
    // the escalate rule instead of dying here.
    const allows = c.rules.some((r) => r.effect === "allow")
    if (allows) {
      const mentioned = c.rules.some(
        (r) => (r.effect === "allow" || r.effect === "escalate") && capabilityMatches(r.pattern, c.capability),
      )
      if (!mentioned) {
        return { effect: "deny", ruleId: "capability_allowlist", code: "CAPABILITY_NOT_ALLOWED", reason: `Capability '${c.capability}' is not in the allow-list` }
      }
    }
    return allow("capability_allowlist")
  },
}

const escalateRule: Rule<CapabilityContext> = {
  id: "capability_escalate",
  run(c) {
    const hit = c.rules.find((r) => r.effect === "escalate" && capabilityMatches(r.pattern, c.capability))
    if (hit) {
      return { effect: "escalate", ruleId: "capability_escalate", code: "CAPABILITY_ESCALATION_REQUIRED", reason: `Capability '${c.capability}' requires human approval (${hit.pattern})` }
    }
    return allow("capability_escalate")
  },
}

// Precedence (deny-overrides): blocked → allow-list → escalate → allow.
export const CAPABILITY_RULES: Rule<CapabilityContext>[] = [blockRule, allowlistRule, escalateRule]

export type CapabilityDecisionCode = "CAPABILITY_BLOCKED" | "CAPABILITY_NOT_ALLOWED" | "CAPABILITY_ESCALATION_REQUIRED"

export const CAPABILITY_REMEDIATION: Record<CapabilityDecisionCode, string> = {
  CAPABILITY_BLOCKED: "This capability is blocked by policy. Use an allowed capability or ask the owner to unblock the pattern.",
  CAPABILITY_NOT_ALLOWED: "This capability is not in the allow-list. Ask the owner to add a matching pattern, or use an allowed capability.",
  CAPABILITY_ESCALATION_REQUIRED: "This capability requires human approval. Poll for status, or wait for the owner to approve.",
}

export type CapabilityDecision = {
  status: "allowed" | "escalated" | "denied"
  code?: CapabilityDecisionCode
  reason?: string
}

/** Decide a capability through the engine and map to the API shape. */
export function decideCapability(ctx: CapabilityContext): CapabilityDecision {
  const d = evaluate(ctx, CAPABILITY_RULES)
  const status = d.effect === "allow" ? "allowed" : d.effect === "escalate" ? "escalated" : "denied"
  return { status, code: d.code as CapabilityDecisionCode | undefined, reason: d.reason }
}
