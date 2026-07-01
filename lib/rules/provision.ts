// Provision rules — govern resource allocation ("provision N seats of X for $Y")
// through the policy decision engine (ADR-0009). A provision is real dollars plus
// a governed resource, so the dollar gates are the spend rules verbatim (shared
// daily budget, per-txn ceiling, floor-over-escalation ladder) and the resource
// gate mirrors tool governance: blocked/allow-list/escalate lists on the wallet
// policy, empty allow-list = allow all. A resource on the escalate list always
// requires a human, regardless of amount — it short-circuits before the ladder.

import { allow, type Rule } from "@/lib/evaluation"
import {
  categoryRule,
  dailyBudgetRule,
  executionBudgetRule,
  humanApproval,
  ladderRule,
  perTransactionRule,
  type SpendContext,
} from "@/lib/rules/spend"

export type ProvisionContext = SpendContext & {
  resource: string
  blockedResources: string[]
  allowedResources: string[]
  escalateResources: string[]
}

export const resourceRule: Rule<ProvisionContext> = {
  id: "resource",
  run(c) {
    if (c.blockedResources.includes(c.resource)) {
      return { effect: "deny", ruleId: "resource", code: "RESOURCE_BLOCKED", reason: `Resource '${c.resource}' is blocked` }
    }
    if (c.allowedResources.length > 0 && !c.allowedResources.includes(c.resource)) {
      return { effect: "deny", ruleId: "resource", code: "RESOURCE_NOT_ALLOWED", reason: `Resource '${c.resource}' is not in the resource allow-list` }
    }
    if (c.escalateResources.includes(c.resource)) {
      return {
        effect: "escalate",
        ruleId: "resource",
        code: "ESCALATION_REQUIRED",
        reason: `Resource '${c.resource}' requires human approval`,
        obligations: humanApproval(c),
      }
    }
    return allow("resource")
  },
}

// The pure ladder (no execution-token gate) — the simulate path + decideProvisionPolicy.
export const PROVISION_LADDER: Rule<ProvisionContext>[] = [resourceRule, categoryRule, perTransactionRule, dailyBudgetRule, ladderRule]

// Live route: stateless gates run before the advisory lock…
export const PROVISION_STATELESS: Rule<ProvisionContext>[] = [resourceRule, categoryRule, perTransactionRule]

// …and the stateful gates + ladder run inside it, against budget state read under the lock.
export const PROVISION_STATEFUL: Rule<ProvisionContext>[] = [dailyBudgetRule, executionBudgetRule, ladderRule]
