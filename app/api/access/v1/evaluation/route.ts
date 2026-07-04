import { NextRequest } from "next/server"
import { authenticateAgent } from "@/lib/auth"
import { AuthZenBadRequest, authzenRespond as respond, evaluateAuthZen, evaluationRequestSchema } from "@/lib/authzen"
import { logger } from "@/lib/log"

const log = logger("access/v1/evaluation")

// OpenID AuthZEN 1.0 Access Evaluation API. Mounted at the spec's canonical
// path relative to the PDP base URL (https://getsanction.com/api), so any
// AuthZEN PEP pointed at that base interoperates without Sanction-specific
// code. Auth is the agent data plane (x-api-key) — the PDP answers for the
// agent the key belongs to. See lib/authzen.ts for the SARC → engine mapping.

export async function POST(req: NextRequest) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) {
    log.warn("auth failed", { error })
    return respond(req, { error }, 401)
  }

  const parsed = evaluationRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return respond(req, { error: "Invalid request", details: parsed.error.flatten() }, 400)
  }

  try {
    return respond(req, await evaluateAuthZen(agent, parsed.data, { origin: req.nextUrl.origin }), 200)
  } catch (e) {
    if (e instanceof AuthZenBadRequest) return respond(req, { error: e.message }, 400)
    throw e
  }
}
