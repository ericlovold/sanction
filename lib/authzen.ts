import { z } from "zod"
import { db } from "@/lib/db"
import { decidePolicy, decideProvisionPolicy, decisionCode, REMEDIATION, type DecisionCode } from "@/lib/decisions"
import { decideTool, TOOL_REMEDIATION } from "@/lib/toolDecisions"
import {
  SUBTREE_CAP_EXCEEDED_NOTE,
  cascadeDailyWouldExceed,
  effectivePerTransactionMaxCents,
  walletAncestorChain,
} from "@/lib/cascadeBudget"

// OpenID AuthZEN Authorization API 1.0 — Sanction as a PDP.
//
// A PEP (an MCP gateway, an agent framework, another service) POSTs the
// standard subject/action/resource/context tuple and gets back the standard
// { decision: boolean } — no Sanction SDK required. The mapping onto the
// engine is by resource.type:
//
//   tool      → the tool ladder (blocked / allow-list / escalate), pure
//   spend     → the spend ladder against live budget state
//   provision → the provision ladder (resource gate + spend gates)
//
// Evaluation is DECISION-ONLY: nothing is persisted, no budget is debited,
// no approval is opened — the same contract as ?simulate=true on /authorize.
// A "would escalate" outcome is decision:false with a context.code telling
// the PEP which Sanction endpoint opens the real approval. The AuthZEN
// access-request-and-approval profile (AARP) is phase 2.
//
// Per the spec, a deny is a successful evaluation: HTTP 200 with
// decision:false. context carries Sanction's stable machine code +
// remediation so agents replan instead of hallucinating on a bare false.

export const AUTHZEN_BATCH_MAX = 50

const entitySchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1),
  properties: z.record(z.string(), z.unknown()).optional(),
})

const actionSchema = z.object({
  name: z.string().min(1),
  properties: z.record(z.string(), z.unknown()).optional(),
})

export const evaluationRequestSchema = z.object({
  subject: entitySchema,
  action: actionSchema,
  resource: entitySchema,
  context: z.record(z.string(), z.unknown()).optional(),
})

// Batch: top-level members are defaults; each item overrides them wholesale
// (member-level replace, no deep merge — per the spec's evaluations semantics).
const partialEvaluationSchema = z.object({
  subject: entitySchema.optional(),
  action: actionSchema.optional(),
  resource: entitySchema.optional(),
  context: z.record(z.string(), z.unknown()).optional(),
})

export const evaluationsRequestSchema = partialEvaluationSchema.extend({
  evaluations: z.array(partialEvaluationSchema).max(AUTHZEN_BATCH_MAX).optional(),
  options: z
    .object({
      evaluations_semantic: z.enum(["execute_all", "deny_on_first_deny", "permit_on_first_permit"]).optional(),
    })
    .optional(),
})

export type AuthZenRequest = z.infer<typeof evaluationRequestSchema>
export type AuthZenBatchRequest = z.infer<typeof evaluationsRequestSchema>
export type EvaluationsSemantic = "execute_all" | "deny_on_first_deny" | "permit_on_first_permit"

export type AuthZenDecision = {
  decision: boolean
  context?: { code: string; reason?: string; remediation?: string }
}

/** Malformed-but-parseable requests (missing amount, bad arithmetic) → HTTP 400. */
export class AuthZenBadRequest extends Error {}

// AuthZEN-specific codes, alongside the engine's DecisionCodes.
const AUTHZEN_REMEDIATION: Record<string, string> = {
  SUBJECT_MISMATCH:
    "This PDP evaluates the authenticated agent only. Set subject.id to the agent id (or name) that owns the presented API key.",
  UNSUPPORTED_RESOURCE_TYPE: "Sanction evaluates resource.type 'tool', 'spend', or 'provision'.",
}

// Evaluation never opens an approval; tell the PEP which endpoint does.
const OPEN_APPROVAL: Record<string, string> = {
  tool: " Evaluation is decision-only — POST the invocation to /api/v1/authorize/tool to open the approval and receive a grant.",
  spend: " Evaluation is decision-only — POST the action to /api/v1/authorize to open the approval and receive a grant.",
  provision:
    " Evaluation is decision-only — POST the action to /api/v1/authorize/provision to open the approval and receive a grant.",
}

type PolicyShape = {
  blockedCategories: string[]
  allowedCategories: string[]
  perTransactionMaxUsd: number
  dailySpendBudgetUsd: number
  monthlySpendBudgetUsd: number | null
  autoApproveUnderUsd: number
  escalateOverUsd: number
  blockedTools: string[]
  allowedTools: string[]
  escalateTools: string[]
  blockedResources: string[]
  allowedResources: string[]
  escalateResources: string[]
}

export type AuthZenAgent = {
  id: string
  name: string
  walletId: string
  perTransactionMaxUsd: number | null
  dailySpendBudgetUsd: number | null
  escalateOverUsd: number | null
  wallet: { policy: PolicyShape | null }
}

function deny(code: string, reason: string, remediation?: string): AuthZenDecision {
  return { decision: false, context: { code, reason, remediation } }
}

/** Merge one batch item over the top-level defaults (member-level replace). */
export function mergeEvaluation(defaults: AuthZenBatchRequest, item: z.infer<typeof partialEvaluationSchema>) {
  return {
    subject: item.subject ?? defaults.subject,
    action: item.action ?? defaults.action,
    resource: item.resource ?? defaults.resource,
    context: item.context ?? defaults.context,
  }
}

function numberProp(props: Record<string, unknown>, key: string): number | undefined {
  const v = props[key]
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

function stringProp(props: Record<string, unknown>, key: string): string | undefined {
  const v = props[key]
  return typeof v === "string" && v.length > 0 ? v : undefined
}

// Live budget state, read exactly like the ?simulate=true paths: the agent's
// approved daily/monthly totals plus the ancestor chain for cascading caps.
async function readSpendState(agent: AuthZenAgent) {
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [daily, monthly, ancestorChain] = await Promise.all([
    db.authorizationRequest.aggregate({
      where: { agentId: agent.id, status: "approved", createdAt: { gte: dayStart } },
      _sum: { amountUsd: true },
    }),
    db.authorizationRequest.aggregate({
      where: { agentId: agent.id, status: "approved", createdAt: { gte: monthStart } },
      _sum: { amountUsd: true },
    }),
    walletAncestorChain(db, agent.walletId),
  ])
  return {
    dailySpentUsd: daily._sum.amountUsd ?? 0,
    monthlySpentUsd: monthly._sum.amountUsd ?? 0,
    ancestorChain,
  }
}

/**
 * Evaluate one AuthZEN tuple for the authenticated agent. Decision-only:
 * reads budget state, never writes. Throws AuthZenBadRequest on requests
 * that parse but are semantically malformed (missing amount, bad arithmetic).
 */
export async function evaluateAuthZen(agent: AuthZenAgent, r: AuthZenRequest): Promise<AuthZenDecision> {
  // Sanction's authority is the presented API key: it can only answer for the
  // agent that key belongs to. Asking about anyone else fails closed.
  if (r.subject.id !== agent.id && r.subject.id !== agent.name) {
    return deny(
      "SUBJECT_MISMATCH",
      `subject.id '${r.subject.id}' is not the authenticated agent`,
      AUTHZEN_REMEDIATION.SUBJECT_MISMATCH,
    )
  }

  const policy = agent.wallet.policy
  if (!policy) return deny("NO_POLICY", "No policy configured", REMEDIATION.NO_POLICY)

  const props = { ...r.resource.properties, ...r.action.properties }

  switch (r.resource.type) {
    case "tool": {
      const d = decideTool({
        tool: r.resource.id,
        blockedTools: policy.blockedTools,
        allowedTools: policy.allowedTools,
        escalateTools: policy.escalateTools,
      })
      if (d.status === "allowed") return { decision: true }
      const remediation = d.code
        ? TOOL_REMEDIATION[d.code] + (d.status === "escalated" ? OPEN_APPROVAL.tool : "")
        : undefined
      return { decision: false, context: { code: d.code ?? "POLICY_DENIED", reason: d.reason, remediation } }
    }

    case "spend": {
      const amountUsd = numberProp(props, "amount_usd")
      if (amountUsd === undefined || amountUsd <= 0) {
        throw new AuthZenBadRequest("spend evaluation requires a positive numeric amount_usd property")
      }
      const category = stringProp(props, "category") ?? "general"
      const state = await readSpendState(agent)
      const decision = decidePolicy({
        amountUsd,
        category,
        blockedCategories: policy.blockedCategories,
        allowedCategories: policy.allowedCategories,
        perTxnMaxCents: effectivePerTransactionMaxCents(
          agent.perTransactionMaxUsd,
          policy.perTransactionMaxUsd,
          state.ancestorChain,
        ),
        dailySpentUsd: state.dailySpentUsd,
        dailyBudgetCents: agent.dailySpendBudgetUsd ?? policy.dailySpendBudgetUsd,
        monthlySpentUsd: state.monthlySpentUsd,
        monthlyBudgetCents: policy.monthlySpendBudgetUsd,
        autoApproveUnderCents: policy.autoApproveUnderUsd,
        escalateOverCents: agent.escalateOverUsd ?? policy.escalateOverUsd,
      })
      return settleSpendDecision(agent, decision, amountUsd, state.ancestorChain, "spend")
    }

    case "provision": {
      const amountUsd = numberProp(props, "amount_usd")
      if (amountUsd === undefined || amountUsd <= 0) {
        throw new AuthZenBadRequest("provision evaluation requires a positive numeric amount_usd property")
      }
      const quantity = numberProp(props, "quantity")
      const unitPriceUsd = numberProp(props, "unit_price_usd")
      // Same arithmetic contract as /authorize/provision: when a unit price is
      // supplied the math must hold — a mismatch is a malformed request.
      if (
        unitPriceUsd !== undefined &&
        quantity !== undefined &&
        quantity * Math.round(unitPriceUsd * 100) !== Math.round(amountUsd * 100)
      ) {
        throw new AuthZenBadRequest("quantity × unit_price_usd must equal amount_usd")
      }
      const category = stringProp(props, "category") ?? "general"
      const state = await readSpendState(agent)
      const decision = decideProvisionPolicy({
        amountUsd,
        category,
        blockedCategories: policy.blockedCategories,
        allowedCategories: policy.allowedCategories,
        perTxnMaxCents: effectivePerTransactionMaxCents(
          agent.perTransactionMaxUsd,
          policy.perTransactionMaxUsd,
          state.ancestorChain,
        ),
        dailySpentUsd: state.dailySpentUsd,
        dailyBudgetCents: agent.dailySpendBudgetUsd ?? policy.dailySpendBudgetUsd,
        monthlySpentUsd: state.monthlySpentUsd,
        monthlyBudgetCents: policy.monthlySpendBudgetUsd,
        autoApproveUnderCents: policy.autoApproveUnderUsd,
        escalateOverCents: agent.escalateOverUsd ?? policy.escalateOverUsd,
        resource: r.resource.id,
        blockedResources: policy.blockedResources,
        allowedResources: policy.allowedResources,
        escalateResources: policy.escalateResources,
      })
      return settleSpendDecision(agent, decision, amountUsd, state.ancestorChain, "provision")
    }

    default:
      return deny(
        "UNSUPPORTED_RESOURCE_TYPE",
        `resource.type '${r.resource.type}' is not governed by this PDP`,
        AUTHZEN_REMEDIATION.UNSUPPORTED_RESOURCE_TYPE,
      )
  }
}

// Map a spend/provision ladder outcome to the AuthZEN shape, checking the
// subtree cap only for would-be approvals (mirrors live/simulate precedence).
async function settleSpendDecision(
  agent: AuthZenAgent,
  decision: { status: "approved" | "escalated" | "denied"; note: string },
  amountUsd: number,
  ancestorChain: Awaited<ReturnType<typeof walletAncestorChain>>,
  kind: "spend" | "provision",
): Promise<AuthZenDecision> {
  if (decision.status === "approved") {
    if (await cascadeDailyWouldExceed(db, agent.walletId, Math.round(amountUsd * 100), new Date(), ancestorChain)) {
      return deny("SUBTREE_CAP_EXCEEDED", SUBTREE_CAP_EXCEEDED_NOTE, REMEDIATION.SUBTREE_CAP_EXCEEDED)
    }
    return { decision: true }
  }
  const code: DecisionCode = decisionCode(decision.status, decision.note) ?? "POLICY_DENIED"
  const remediation = REMEDIATION[code] + (decision.status === "escalated" ? OPEN_APPROVAL[kind] : "")
  return { decision: false, context: { code, reason: decision.note, remediation } }
}
