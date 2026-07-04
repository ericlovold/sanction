import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "@/lib/auth"
import {
  AuthZenBadRequest,
  evaluateAuthZen,
  evaluationRequestSchema,
  evaluationsRequestSchema,
  mergeEvaluation,
  type AuthZenRequest,
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
  const evaluations = []
  try {
    for (const item of merged) {
      const decision = await evaluateAuthZen(agent, item)
      evaluations.push(decision)
      if (semantic === "deny_on_first_deny" && !decision.decision) break
      if (semantic === "permit_on_first_permit" && decision.decision) break
    }
  } catch (e) {
    if (e instanceof AuthZenBadRequest) return respond(req, { error: e.message }, 400)
    throw e
  }

  return respond(req, { evaluations }, 200)
}

// The spec recommends echoing the PEP's X-Request-ID on every response.
function respond(req: NextRequest, body: unknown, status: number) {
  const res = NextResponse.json(body, { status })
  const requestId = req.headers.get("x-request-id")
  if (requestId) res.headers.set("X-Request-ID", requestId)
  return res
}
