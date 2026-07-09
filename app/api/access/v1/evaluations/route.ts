import { NextRequest } from "next/server"
import { authenticateAgent } from "@/lib/auth"
import {
  AuthZenBadRequest,
  authzenRespond as respond,
  evaluateAuthZen,
  evaluationRequestSchema,
  evaluationsRequestSchema,
  mergeEvaluation,
  publicOrigin,
  validateAuthZenSemantics,
  type AuthZenRequest,
  type AuthZenDecision,
  type EvaluationsSemantic,
} from "@/lib/authzen"
import { authzenRateLimit } from "@/lib/authzenRateLimit"
import { logger } from "@/lib/log"

const log = logger("access/v1/evaluations")

// OpenID AuthZEN 1.0 Access Evaluations API (batch). Top-level
// subject/action/resource are defaults each item overrides member-wise;
// options.evaluations_semantic controls short-circuiting. All items are
// validated up front — schema AND semantics — so one malformed item fails the
// whole request with 400 BEFORE any evaluation runs; an AARP redemption in a
// sibling item must never consume its grant into a 400 it didn't cause.

export async function POST(req: NextRequest) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) {
    log.warn("auth failed", { error })
    return respond(req, { error }, 401)
  }

  // Per-agent: one batch fans out to ~3 DB reads per item, so the batch API
  // gets a tighter window than the single evaluation.
  const limited = await authzenRateLimit(req, "authzen-evals", agent.id, 60)
  if (limited) return limited

  const parsed = evaluationsRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return respond(req, { error: "Invalid request", details: parsed.error.flatten() }, 400)
  }

  // Explicit empty batch → empty result (nothing was asked). Only an ABSENT
  // array means "the defaults are the single evaluation" (per spec).
  if (parsed.data.evaluations !== undefined && parsed.data.evaluations.length === 0) {
    return respond(req, { evaluations: [] }, 200)
  }
  const items = parsed.data.evaluations ?? [{}]
  const merged: AuthZenRequest[] = []
  for (const [i, item] of items.entries()) {
    const full = evaluationRequestSchema.safeParse(mergeEvaluation(parsed.data, item))
    if (!full.success) {
      return respond(req, { error: `Invalid evaluation at index ${i}`, details: full.error.flatten() }, 400)
    }
    try {
      validateAuthZenSemantics(full.data)
    } catch (e) {
      if (e instanceof AuthZenBadRequest) {
        return respond(req, { error: `Invalid evaluation at index ${i}: ${e.message}` }, 400)
      }
      throw e
    }
    merged.push(full.data)
  }

  const semantic: EvaluationsSemantic = parsed.data.options?.evaluations_semantic ?? "execute_all"
  let evaluations: AuthZenDecision[] = []
  try {
    const origin = publicOrigin(req)
    if (semantic === "execute_all") {
      // Items are independent under execute_all — evaluate concurrently;
      // Promise.all preserves request order in the result.
      evaluations = await Promise.all(merged.map((item) => evaluateAuthZen(agent, item, { origin })))
    } else {
      // The short-circuiting semantics are inherently sequential.
      for (const item of merged) {
        const decision = await evaluateAuthZen(agent, item, { origin })
        evaluations.push(decision)
        if (semantic === "deny_on_first_deny" && !decision.decision) break
        if (semantic === "permit_on_first_permit" && decision.decision) break
      }
    }
  } catch (e) {
    if (e instanceof AuthZenBadRequest) return respond(req, { error: e.message }, 400)
    throw e
  }

  return respond(req, { evaluations }, 200)
}
