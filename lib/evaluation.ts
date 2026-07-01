// Policy decision engine (ADR-0009). Evolved from the `feat/cascade-wallet-budgets`
// seed (Evaluator<C>/runEvaluators) into the ADR contract: a rule returns a
// RuleResult; the engine folds an ordered list into one Decision.
//
// Rules are PURE over their context — no IO. State reads, persistence, and
// obligation execution live in the enforcement shell around the engine (e.g. the
// /authorize route). That keeps the lock correct and rules unit-testable.
//
// Combining is ordered short-circuit: the first rule returning deny/escalate
// wins. With deny-rules ordered before the escalate ladder, this realizes
// ADR-0009's "deny-overrides → escalate → allow". A deny discards obligations;
// obligations accumulate along allow rules that survive, and an escalate carries
// its own.

export type Effect = "allow" | "deny" | "escalate"

export type Obligation = { enforcement: "required" | "advisory" } & (
  | { type: "reserve_budget"; scope: "agent" | "wallet_tree"; amountCents: number }
  | { type: "audit_log"; event: string }
  | { type: "human_approval"; approvers?: string[]; count?: number; timeoutMins?: number; onTimeout?: "allow" | "deny" }
  | { type: "no_egress"; destinations?: string[] }
  | { type: "require_reviewers"; count: number }
)

// A single rule's local verdict.
export type RuleResult = {
  effect: Effect
  ruleId: string
  code?: string // machine-stable; required on deny/escalate by convention (audit trail)
  reason?: string // human-readable
  obligations?: Obligation[] // honored only if this rule is on the winning path
}

// The engine's composed output.
export type Decision = {
  effect: Effect
  ruleId: string
  code?: string
  reason?: string
  obligations: Obligation[] // accumulated from surviving allow/escalate; empty on a deny
}

export type Rule<C> = { id: string; run(ctx: C): RuleResult }

export function allow(ruleId: string, reason?: string, obligations?: Obligation[]): RuleResult {
  return { effect: "allow", ruleId, reason, obligations }
}

// Ordered evaluation. First deny/escalate wins and short-circuits; if all allow,
// the terminal allow carries the accumulated obligations.
export function evaluate<C>(ctx: C, rules: Rule<C>[]): Decision {
  const obligations: Obligation[] = []
  let last: RuleResult = { effect: "allow", ruleId: "default" }
  for (const rule of rules) {
    const r = rule.run(ctx)
    if (r.effect === "deny") {
      return { effect: "deny", ruleId: r.ruleId, code: r.code, reason: r.reason, obligations: [] }
    }
    if (r.effect === "escalate") {
      return { effect: "escalate", ruleId: r.ruleId, code: r.code, reason: r.reason, obligations: r.obligations ?? [] }
    }
    if (r.obligations) obligations.push(...r.obligations)
    last = r
  }
  return { effect: "allow", ruleId: last.ruleId, code: last.code, reason: last.reason, obligations }
}
