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
  type AuthZenRequest,
  type AuthZenDecision,
  type EvaluationsSemantic,
} from "@/lib/authzen"
import { logger } from "@/lib/log"

const log = logger("access/v1/evaluations")

// OpenID AuthZEN 1.0 Access Evaluations API (batch). Top-level
// subject/action/resource are defaults each item overrides member-wise;
// options.evaluations_semantic controls short-circuiting. All items are
// validated up front — one malformed item fails the whole request with 400
// rather than a partial result set.

export async function POST(req: NextRequest) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) {
    log.warn("auth failed", { error })
    return respond(req, { error }, 401)
  }

  const parsed = evaluationsRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return respond(req, { error: "Invalid request", details: parsed.error.flatten() }, 400)
  }

  // No evaluations array → the defaults are the single evaluation (per spec).
  const items = parsed.data.evaluations?.length ? parsed.data.evaluations : [{}]
  const merged: AuthZenRequest[] = []
  for (const [i, item] of items.entries()) {
    const full = evaluationRequestSchema.safeParse(mergeEvaluation(parsed.data, item))
    if (!full.success) {
      return respond(req, { error: `Invalid evaluation at index ${i}`, details: full.error.flatten() }, 400)
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
