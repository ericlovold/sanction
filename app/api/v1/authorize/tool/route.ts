import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { authenticateAgent } from "@/lib/auth"
import { decideTool, TOOL_REMEDIATION } from "@/lib/toolDecisions"
import { logger } from "@/lib/log"

const log = logger("v1/authorize/tool")

// ADR-0009 M3: authorize any MCP tool invocation the same way spend is authorized.
// "Can this agent invoke this tool?" → allow / deny / escalate via the decision
// engine, against the wallet's tool block/allow/escalate lists. Decision-only for
// now (no persistence); async human-approval for escalated tools reuses the spend
// escalation infra and is the fast-follow.
const schema = z.object({
  tool: z.string().min(1),
  server: z.string().optional(), // MCP server name, e.g. "github", "filesystem" — advisory for now
  arguments: z.record(z.string(), z.unknown()).optional(), // the tool's args — logged, not yet policy-evaluated
})

export async function POST(req: NextRequest) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) {
    log.warn("auth failed", { error })
    return NextResponse.json({ error }, { status: 401 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { tool } = parsed.data

  const policy = agent.wallet.policy
  if (!policy) {
    return NextResponse.json(
      { authorized: false, status: "denied", code: "NO_POLICY", reason: "No policy configured", agent: agent.name, tool },
      { status: 403 },
    )
  }

  const decision = decideTool({
    tool,
    blockedTools: policy.blockedTools,
    allowedTools: policy.allowedTools,
    escalateTools: policy.escalateTools,
  })

  const authorized = decision.status === "allowed"
  return NextResponse.json(
    {
      authorized,
      status: decision.status,
      code: decision.code,
      remediation: decision.code ? TOOL_REMEDIATION[decision.code] : undefined,
      reason: decision.reason,
      agent: agent.name,
      tool,
    },
    { status: decision.status === "denied" ? 403 : 200 },
  )
}
