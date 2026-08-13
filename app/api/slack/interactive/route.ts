import { NextRequest, NextResponse } from "next/server"
import { resolveApproval } from "@/lib/approvals"
import { db } from "@/lib/db"
import { clientIp, rateLimit } from "@/lib/rateLimit"
import {
  parseSlackInteractiveBody,
  slackDecisionFromPayload,
  slackReplacementMessage,
  slackSigningSecret,
  verifySlackSignature,
} from "@/lib/slack"

const NO_STORE = { "Cache-Control": "no-store" } as const

function slackAck(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export async function POST(req: NextRequest) {
  const secret = slackSigningSecret()
  if (!secret) {
    return NextResponse.json({ error: "Slack signing secret is not configured" }, { status: 503, headers: NO_STORE })
  }

  const rl = await rateLimit("slack_interactive", clientIp(req), 60, 60)
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60), ...NO_STORE } },
    )
  }

  const rawBody = await req.text()
  const ok = verifySlackSignature({
    signingSecret: secret,
    timestamp: req.headers.get("x-slack-request-timestamp") ?? "",
    rawBody,
    signature: req.headers.get("x-slack-signature") ?? "",
  })
  if (!ok) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401, headers: NO_STORE })
  }

  const parsed = parseSlackInteractiveBody(rawBody)
  const action = slackDecisionFromPayload(parsed)
  if (!action) {
    return slackAck({ text: "Ignored" })
  }

  const approval = await db.pendingApproval.findFirst({
    where: {
      OR: [
        { id: action.approvalId },
        { sourceType: "authorization_request", sourceId: action.approvalId },
      ],
    },
    select: { id: true, walletId: true },
  })
  if (!approval) {
    return slackAck({
      response_type: "ephemeral",
      text: "That approval is no longer pending.",
    })
  }

  const result = await resolveApproval(
    approval.walletId,
    approval.id,
    action.decision,
    undefined,
    action.actor,
  )
  if (!result.ok) {
    return slackAck({
      response_type: "ephemeral",
      text: result.error,
    })
  }

  return slackAck(slackReplacementMessage(action.decision, action.actor))
}
