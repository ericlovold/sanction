import { z } from "zod"
import { NextRequest, NextResponse } from "next/server"
import { SignJWT, jwtVerify } from "jose"
import { db } from "@/lib/db"
import { decidePolicy, decideProvisionPolicy, decisionCode, REMEDIATION, type DecisionCode } from "@/lib/decisions"
import { decideTool, TOOL_REMEDIATION } from "@/lib/toolDecisions"
import { consumeSpendGrant, consumeProvisionGrant, consumeToolGrant, type GrantConsumeResult } from "@/lib/grants"
import { APPEALABLE_DENIALS } from "@/lib/evidence"
import {
  CascadeBudgetExceeded,
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
  context?: {
    code: string
    reason?: string
    remediation?: string
    // AARP (draft profile): a would-escalate denial is *requestable* — this
    // object tells the PEP where to open the real approval and carries the
    // signed binding token that proves the denial happened here.
    access_request?: AccessRequestOffer
    // AARP re-evaluation denials: machine hint for what the PEP should do next.
    aarp_reason?: "approval_expired" | "out_of_scope" | "grant_pending" | "policy_denied" | "approval_unverifiable"
    next_action?: "request" | "retry" | "none"
    approval_id?: string
  }
}

export type AccessRequestOffer = { endpoint: string; expires_at: string; binding_token: string }

/** Malformed-but-parseable requests (missing amount, bad arithmetic) → HTTP 400. */
export class AuthZenBadRequest extends Error {}

/** Shared PDP response envelope: the spec recommends echoing X-Request-ID on every response. */
export function authzenRespond(req: NextRequest, body: unknown, status: number) {
  const res = NextResponse.json(body, { status })
  const requestId = req.headers.get("x-request-id")
  if (requestId) res.headers.set("X-Request-ID", requestId)
  return res
}

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
 * Evaluate one AuthZEN tuple for the authenticated agent. Fresh evaluations
 * are decision-only: reads budget state, never writes. The one deliberate
 * exception is AARP re-evaluation — a request carrying context.approval
 * redeems the one-use grant the owner minted (the PEP's enforcement moment).
 * Throws AuthZenBadRequest on requests that parse but are semantically
 * malformed (missing amount, bad arithmetic).
 */
export async function evaluateAuthZen(
  agent: AuthZenAgent,
  r: AuthZenRequest,
  opts: { origin?: string } = {},
): Promise<AuthZenDecision> {
  // Sanction's authority is the presented API key: it can only answer for the
  // agent that key belongs to. Asking about anyone else fails closed.
  if (r.subject.id !== agent.id && r.subject.id !== agent.name) {
    return deny(
      "SUBJECT_MISMATCH",
      `subject.id '${r.subject.id}' is not the authenticated agent`,
      AUTHZEN_REMEDIATION.SUBJECT_MISMATCH,
    )
  }

  // AARP re-evaluation: context.approval redeems the grant. Runs before the
  // policy check, exactly like grant_id on the native routes.
  if (r.context && "approval" in r.context) {
    const approvalId = stringProp(asRecord(r.context.approval), "id")
    if (!approvalId) throw new AuthZenBadRequest("context.approval requires a string id")
    return redeemApproval(agent, r, approvalId)
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
      const context: AuthZenDecision["context"] = { code: d.code ?? "POLICY_DENIED", reason: d.reason, remediation }
      if (d.status === "escalated") {
        context.access_request = await accessRequestOffer(agent, r, d.reason, opts.origin)
      }
      return { decision: false, context }
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
      return settleSpendDecision(agent, r, decision, amountUsd, state.ancestorChain, "spend", opts.origin)
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
      return settleSpendDecision(agent, r, decision, amountUsd, state.ancestorChain, "provision", opts.origin)
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
  r: AuthZenRequest,
  decision: { status: "approved" | "escalated" | "denied"; note: string },
  amountUsd: number,
  ancestorChain: Awaited<ReturnType<typeof walletAncestorChain>>,
  kind: "spend" | "provision",
  origin?: string,
): Promise<AuthZenDecision> {
  if (decision.status === "approved") {
    if (await cascadeDailyWouldExceed(db, agent.walletId, Math.round(amountUsd * 100), new Date(), ancestorChain)) {
      return deny("SUBTREE_CAP_EXCEEDED", SUBTREE_CAP_EXCEEDED_NOTE, REMEDIATION.SUBTREE_CAP_EXCEEDED)
    }
    return { decision: true }
  }
  const code: DecisionCode = decisionCode(decision.status, decision.note) ?? "POLICY_DENIED"
  const remediation = REMEDIATION[code] + (decision.status === "escalated" ? OPEN_APPROVAL[kind] : "")
  const context: AuthZenDecision["context"] = { code, reason: decision.note, remediation }
  // Escalations are requestable by definition; hard budget denials are
  // appealable too (UX-3) — same signed offer, same approval inbox.
  if (decision.status === "escalated" || APPEALABLE_DENIALS.has(code)) {
    context.access_request = await accessRequestOffer(agent, r, decision.note, origin)
  }
  return { decision: false, context }
}

// ── AARP: Access Request and Approval Profile (draft 1) ─────────────────────
//
// The profile standardizes exactly the loop Sanction already runs natively:
// requestable denial → access request → human approval → time-boxed approval
// artifact → re-evaluation. Mapping: a would-escalate evaluation is the
// requestable denial; POST /access/v1/access-request opens the same
// AuthorizationRequest + PendingApproval the native routes persist; the AARP
// "approval" IS the one-use grant (approved_until = grant expiry); and
// re-evaluation with context.approval redeems it atomically.
//
// Evaluations are never persisted, so denial binding uses a signed token, not
// an evaluation_id: an HS256 JWS over the canonical subject/action/resource
// (we are both PDP and Access Request Service, so we verify our own
// signature — no JWKS needed). Deliberately not implemented from the draft:
// callbacks (native webhooks already notify), catalogs/form schemas, bulk
// items[].

export const AUTHZEN_CAPABILITY_ACCESS_REQUEST = "urn:openid:authzen:capability:access-request"
export const ACCESS_REQUEST_PATH = "/api/access/v1/access-request"
const BINDING_TOKEN_PURPOSE = "authzen-access-request"
const BINDING_TOKEN_TTL_MINS = 15
const DEFAULT_ORIGIN = "https://getsanction.com"

// RFC 9457 problem types from the AARP draft.
export const AARP_PROBLEM = {
  invalid_denial_binding: "urn:openid:authzen:access-request:error:invalid_denial_binding",
  expired_denial: "urn:openid:authzen:access-request:error:expired_denial",
  unknown_task: "urn:openid:authzen:access-request:error:unknown_task",
} as const

/**
 * Map a persisted AuthorizationRequest state to the profile's task status.
 * Timeout settlement is detected via decisionCode — the canonical
 * (status, decisionNote) → code contract — not by re-matching note text here.
 */
export function aarpTaskStatus(status: string, decisionNote: string | null): "pending" | "approved" | "denied" | "expired" {
  if (status === "escalated") return "pending"
  if (status === "approved") return "approved"
  return decisionCode(status, decisionNote) === "ESCALATION_TIMED_OUT" ? "expired" : "denied"
}

/** RFC 9457 problem+json response for the AARP endpoints. */
export function aarpProblem(req: NextRequest, type: string, title: string, status: number) {
  const res = NextResponse.json({ type, title, status }, { status })
  res.headers.set("content-type", "application/problem+json")
  const requestId = req.headers.get("x-request-id")
  if (requestId) res.headers.set("X-Request-ID", requestId)
  return res
}

const denialSchema = z.object({
  binding_token: z.string().min(1),
  evaluation_id: z.string().optional(),
  evaluated_at: z.string().optional(),
  expires_at: z.string().optional(),
  reason: z.string().optional(),
  template: z.string().optional(),
})

export const accessRequestSchema = z.object({
  subject: z.object({ type: z.string().min(1), id: z.string().min(1), properties: z.record(z.string(), z.unknown()).optional() }),
  action: z.object({ name: z.string().min(1), properties: z.record(z.string(), z.unknown()).optional() }),
  resource: z.object({ type: z.string().min(1), id: z.string().min(1), properties: z.record(z.string(), z.unknown()).optional() }),
  context: z.record(z.string(), z.unknown()).optional(),
  denial: denialSchema,
  requested_access: z.record(z.string(), z.unknown()).optional(),
  callback: z.record(z.string(), z.unknown()).optional(), // accepted, unsupported — native webhooks notify
  client: z.record(z.string(), z.unknown()).optional(),
})

export type AccessRequestBody = z.infer<typeof accessRequestSchema>

// The canonical subject/action/resource a binding token signs over — the
// "authorization-relevant context" of this profile. Built identically at
// denial time and at submission time, so equality proves the submission is
// the denied evaluation.
export type CanonicalSarc =
  | { t: "tool"; tool: string; server: string | null }
  | { t: "spend"; action: string; merchant: string; amount_cents: number; category: string }
  | {
      t: "provision"
      resource: string
      line_item: string
      quantity: number
      unit_price_cents: number | null
      amount_cents: number
      category: string
    }

export function canonicalSarc(r: AuthZenRequest): CanonicalSarc {
  const props = { ...r.resource.properties, ...r.action.properties }
  switch (r.resource.type) {
    case "tool":
      return { t: "tool", tool: r.resource.id, server: stringProp(props, "server") ?? null }
    case "spend": {
      const amountUsd = numberProp(props, "amount_usd")
      if (amountUsd === undefined || amountUsd <= 0) {
        throw new AuthZenBadRequest("spend requires a positive numeric amount_usd property")
      }
      return {
        t: "spend",
        action: r.action.name,
        merchant: r.resource.id,
        amount_cents: Math.round(amountUsd * 100),
        category: stringProp(props, "category") ?? "general",
      }
    }
    case "provision": {
      const amountUsd = numberProp(props, "amount_usd")
      if (amountUsd === undefined || amountUsd <= 0) {
        throw new AuthZenBadRequest("provision requires a positive numeric amount_usd property")
      }
      const quantity = numberProp(props, "quantity")
      const unitPriceUsd = numberProp(props, "unit_price_usd")
      // Same arithmetic contract as the evaluation path — canonicalSarc also
      // guards access-request submission and redemption, which don't pass
      // through the evaluation branch's own check.
      if (
        unitPriceUsd !== undefined &&
        quantity !== undefined &&
        quantity * Math.round(unitPriceUsd * 100) !== Math.round(amountUsd * 100)
      ) {
        throw new AuthZenBadRequest("quantity × unit_price_usd must equal amount_usd")
      }
      return {
        t: "provision",
        resource: r.resource.id,
        line_item: stringProp(props, "line_item") ?? r.resource.id,
        quantity: quantity ?? 1,
        unit_price_cents: unitPriceUsd !== undefined ? Math.round(unitPriceUsd * 100) : null,
        amount_cents: Math.round(amountUsd * 100),
        category: stringProp(props, "category") ?? "general",
      }
    }
    default:
      throw new AuthZenBadRequest(`resource.type '${r.resource.type}' is not requestable`)
  }
}

/**
 * The origin advertised in discovery documents and access_request offers.
 * SANCTION_PUBLIC_ORIGIN pins it in deployments behind proxies where the
 * request host can't be trusted; unset (local, CI, Vercel previews — where
 * the platform validates the Host header) the request origin is used so
 * every deployment self-describes correctly.
 */
export function publicOrigin(req: NextRequest): string {
  return process.env.SANCTION_PUBLIC_ORIGIN || req.nextUrl.origin
}

function getSigningKey() {
  const secret = process.env.SANCTION_SIGNING_SECRET
  if (!secret) throw new Error("SANCTION_SIGNING_SECRET not set")
  return new TextEncoder().encode(secret)
}

/** The requestable-denial offer: signed proof this denial happened here. */
export async function accessRequestOffer(
  agent: AuthZenAgent,
  r: AuthZenRequest,
  reason: string | undefined,
  origin?: string,
): Promise<AccessRequestOffer> {
  const expiresAt = new Date(Date.now() + BINDING_TOKEN_TTL_MINS * 60_000)
  const token = await new SignJWT({ purpose: BINDING_TOKEN_PURPOSE, sarc: canonicalSarc(r), reason })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("sanction")
    .setAudience([agent.walletId])
    .setSubject(agent.id)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getSigningKey())
  return {
    endpoint: `${origin ?? DEFAULT_ORIGIN}${ACCESS_REQUEST_PATH}`,
    expires_at: expiresAt.toISOString(),
    binding_token: token,
  }
}

export type BindingVerification =
  | { ok: true; sarc: CanonicalSarc; reason?: string }
  | { ok: false; expired: boolean }

/** Verify a binding token belongs to this agent and extract the signed SARC. */
export async function verifyBindingToken(agent: AuthZenAgent, token: string): Promise<BindingVerification> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), {
      issuer: "sanction",
      audience: agent.walletId,
      algorithms: ["HS256"],
    })
    if (payload.purpose !== BINDING_TOKEN_PURPOSE || payload.sub !== agent.id || !payload.sarc) {
      return { ok: false, expired: false }
    }
    return {
      ok: true,
      sarc: payload.sarc as CanonicalSarc,
      reason: typeof payload.reason === "string" ? payload.reason : undefined,
    }
  } catch (e) {
    const expired = typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "ERR_JWT_EXPIRED"
    return { ok: false, expired }
  }
}

export function sarcEquals(a: CanonicalSarc, b: CanonicalSarc): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// AARP re-evaluation: redeem the grant behind context.approval — the one
// deliberate write on this surface. Consumption is atomic and one-use, exactly
// the native grant semantics; an already-consumed approval denies with
// aarp_reason approval_expired so the PEP knows to request again.
async function redeemApproval(agent: AuthZenAgent, r: AuthZenRequest, grantId: string): Promise<AuthZenDecision> {
  const props = { ...r.resource.properties, ...r.action.properties }
  let result: GrantConsumeResult
  try {
    switch (r.resource.type) {
      case "tool": {
        result = await db.$transaction((tx) =>
          consumeToolGrant(tx, {
            grantId,
            walletId: agent.walletId,
            agentId: agent.id,
            request: { tool: r.resource.id, server: stringProp(props, "server") ?? undefined },
          }),
        )
        break
      }
      case "spend":
      case "provision": {
        const sarc = canonicalSarc(r)
        const ancestorChain = await walletAncestorChain(db, agent.walletId)
        result = await db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agent.id})::int8)`
          if (sarc.t === "spend") {
            return consumeSpendGrant(tx, {
              grantId,
              walletId: agent.walletId,
              agentId: agent.id,
              request: {
                action: sarc.action,
                amountUsd: sarc.amount_cents / 100,
                amountCents: sarc.amount_cents,
                merchant: sarc.merchant,
                category: sarc.category,
              },
              ancestorChain,
              execTokenId: null,
            })
          }
          if (sarc.t !== "provision") throw new AuthZenBadRequest("resource.type does not match the approval")
          return consumeProvisionGrant(tx, {
            grantId,
            walletId: agent.walletId,
            agentId: agent.id,
            request: {
              resource: sarc.resource,
              lineItem: sarc.line_item,
              quantity: sarc.quantity,
              amountUsd: sarc.amount_cents / 100,
              amountCents: sarc.amount_cents,
              category: sarc.category,
            },
            ancestorChain,
            execTokenId: null,
          })
        })
        break
      }
      default:
        return deny(
          "UNSUPPORTED_RESOURCE_TYPE",
          `resource.type '${r.resource.type}' is not governed by this PDP`,
          AUTHZEN_REMEDIATION.UNSUPPORTED_RESOURCE_TYPE,
        )
    }
  } catch (e) {
    if (e instanceof CascadeBudgetExceeded) {
      return {
        decision: false,
        context: {
          code: "SUBTREE_CAP_EXCEEDED",
          reason: SUBTREE_CAP_EXCEEDED_NOTE,
          remediation: REMEDIATION.SUBTREE_CAP_EXCEEDED,
          aarp_reason: "policy_denied",
          next_action: "none",
        },
      }
    }
    throw e
  }

  if (result.ok) {
    return { decision: true, context: { code: "GRANT_CONSUMED", reason: "Grant consumed", approval_id: result.grantId } }
  }

  const aarp = GRANT_FAILURE_TO_AARP[result.code] ?? { aarp_reason: "approval_unverifiable" as const, next_action: "none" as const }
  return {
    decision: false,
    context: {
      code: result.code,
      reason: result.reason,
      remediation: REMEDIATION[result.code],
      ...aarp,
    },
  }
}

// Native grant-failure codes → the profile's re-evaluation reason + next_action.
const GRANT_FAILURE_TO_AARP: Record<
  string,
  { aarp_reason: NonNullable<AuthZenDecision["context"]>["aarp_reason"]; next_action: NonNullable<AuthZenDecision["context"]>["next_action"] }
> = {
  GRANT_EXPIRED: { aarp_reason: "approval_expired", next_action: "request" },
  GRANT_ALREADY_USED: { aarp_reason: "approval_expired", next_action: "request" },
  GRANT_NOT_FOUND: { aarp_reason: "approval_unverifiable", next_action: "none" },
  GRANT_UNSUPPORTED: { aarp_reason: "approval_unverifiable", next_action: "none" },
  GRANT_MISMATCH: { aarp_reason: "out_of_scope", next_action: "request" },
  POLICY_DENIED: { aarp_reason: "policy_denied", next_action: "none" },
  EXEC_BUDGET_EXCEEDED: { aarp_reason: "policy_denied", next_action: "none" },
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
