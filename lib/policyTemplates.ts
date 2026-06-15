// Policy templates — plain-English starting points so wallet owners aren't
// faced with a blank budget form (UX-3). All monetary values are in CENTS, to
// match the Policy model. `decide()` / /authorize read these same fields.

export interface PolicyShape {
  dailyTokenBudgetUsd: number
  dailySpendBudgetUsd: number
  perTransactionMaxUsd: number
  autoApproveUnderUsd: number
  escalateOverUsd: number
  allowedCategories: string[]
  blockedCategories: string[]
}

export interface PolicyTemplate extends PolicyShape {
  id: string
  name: string
  description: string
}

const BASE_CATEGORIES = ["software", "services", "research", "infrastructure"]
const BASE_BLOCKED = ["gambling", "adult", "crypto"]

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    id: "conservative",
    name: "Conservative",
    description: "Tight limits, escalate early. Best for a new or untrusted agent.",
    dailyTokenBudgetUsd: 500, // $5
    dailySpendBudgetUsd: 2000, // $20
    perTransactionMaxUsd: 1000, // $10
    autoApproveUnderUsd: 500, // $5
    escalateOverUsd: 2500, // $25
    allowedCategories: BASE_CATEGORIES,
    blockedCategories: BASE_BLOCKED,
  },
  {
    id: "balanced",
    name: "Balanced",
    description: "Sensible defaults for a working agent. Matches the out-of-the-box policy.",
    dailyTokenBudgetUsd: 1000, // $10
    dailySpendBudgetUsd: 5000, // $50
    perTransactionMaxUsd: 5000, // $50
    autoApproveUnderUsd: 2500, // $25
    escalateOverUsd: 10000, // $100
    allowedCategories: BASE_CATEGORIES,
    blockedCategories: BASE_BLOCKED,
  },
  {
    id: "growth",
    name: "Growth",
    description: "Higher throughput for a trusted production agent.",
    dailyTokenBudgetUsd: 5000, // $50
    dailySpendBudgetUsd: 25000, // $250
    perTransactionMaxUsd: 20000, // $200
    autoApproveUnderUsd: 10000, // $100
    escalateOverUsd: 50000, // $500
    allowedCategories: BASE_CATEGORIES,
    blockedCategories: BASE_BLOCKED,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "High limits and a broader category set for a mature, audited deployment.",
    dailyTokenBudgetUsd: 50000, // $500
    dailySpendBudgetUsd: 200000, // $2,000
    perTransactionMaxUsd: 100000, // $1,000
    autoApproveUnderUsd: 25000, // $250
    escalateOverUsd: 100000, // $1,000
    allowedCategories: [...BASE_CATEGORIES, "marketing", "data"],
    blockedCategories: ["gambling", "adult"],
  },
]

export function getTemplate(id: string): PolicyTemplate | undefined {
  return POLICY_TEMPLATES.find((t) => t.id === id)
}

const POLICY_FIELDS: (keyof PolicyShape)[] = [
  "dailyTokenBudgetUsd",
  "dailySpendBudgetUsd",
  "perTransactionMaxUsd",
  "autoApproveUnderUsd",
  "escalateOverUsd",
  "allowedCategories",
  "blockedCategories",
]

/**
 * Resolve the final policy from an optional template plus optional field
 * overrides. Overrides win field-by-field. Returns only defined policy fields.
 */
export function resolvePolicy(
  template: PolicyShape | undefined,
  overrides: Partial<PolicyShape> = {},
): Partial<PolicyShape> {
  const out: Partial<PolicyShape> = {}
  for (const f of POLICY_FIELDS) {
    const override = overrides[f]
    if (override !== undefined) {
      ;(out as Record<string, unknown>)[f] = override
    } else if (template && template[f] !== undefined) {
      ;(out as Record<string, unknown>)[f] = template[f]
    }
  }
  return out
}
