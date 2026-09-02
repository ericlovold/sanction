import { NextRequest, NextResponse } from "next/server"
import { track } from "@vercel/analytics/server"
import { resolveApproval } from "@/lib/approvals"
import { FUNNEL } from "@/lib/funnel"
import { db } from "@/lib/db"
import { clientIp, rateLimit } from "@/lib/rateLimit"
import { withTenant } from "@/lib/rls"
import {
  parseSlackInteractiveBody,
  slackDecisionFromPayload,
  slackReplacementMessage,
  slackSigningSecret,
  verifySlackActionToken,
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

  const binding = await verifySlackActionToken(action.actionToken)
  if (!binding || binding.teamId !== action.teamId || binding.channelId !== action.channelId) {
    return slackAck({ response_type: "ephemeral", text: "This Slack action is no longer valid." })
  }

  const install = await withTenant(binding.walletId, (tx) =>
    tx.slackInstall.findFirst({
      where: {
        walletId: binding.walletId,
        teamId: binding.teamId,
        channelId: binding.channelId,
        revokedAt: null,
      },
      select: { id: true },
    }),
  )
  if (!install) {
    return slackAck({ response_type: "ephemeral", text: "This Slack channel is not authorized for that wallet." })
  }

  const approval = await db.pendingApproval.findFirst({
    where: {
      walletId: binding.walletId,
      OR: [
        { id: binding.approvalId },
        { sourceType: "authorization_request", sourceId: binding.approvalId },
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
    binding.walletId,
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

  // Funnel: the click is the moment Slack proved itself. Best-effort, never
  // on the critical path of the ack (Slack allows 3s).
  track(FUNNEL.slackApprovalClicked, { decision: action.decision }).catch(() => {})
  return slackAck(slackReplacementMessage(action.decision, action.actor))
}
