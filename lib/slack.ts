import { createHmac, timingSafeEqual } from "crypto"

export const SLACK_APPROVE_ACTION = "sanction_approve"
export const SLACK_DENY_ACTION = "sanction_deny"
const SLACK_MAX_SKEW_MS = 5 * 60 * 1000
const REVIEW_URL = "https://getsanction.com/dashboard/approvals"

export function slackSigningSecret(): string | undefined {
  const secret = process.env.SANCTION_SLACK_SIGNING_SECRET
  return secret && secret.length > 0 ? secret : undefined
}

export function slackBotToken(): string | undefined {
  const token = process.env.SANCTION_SLACK_BOT_TOKEN
  return token && token.length > 0 ? token : undefined
}

/** Slack HMAC over `v0:{timestamp}:{rawBody}`. Fail closed on missing/mismatched fields. */
export function verifySlackSignature(opts: {
  signingSecret: string
  timestamp: string
  rawBody: string
  signature: string
  nowMs?: number
}): boolean {
  const { signingSecret, timestamp, rawBody, signature, nowMs = Date.now() } = opts
  if (!/^\d+$/.test(timestamp)) return false
  const tsMs = Number(timestamp) * 1000
  if (!Number.isFinite(tsMs) || Math.abs(nowMs - tsMs) > SLACK_MAX_SKEW_MS) return false
  if (!signature.startsWith("v0=")) return false

  const digest =
    "v0=" + createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex")
  const a = Buffer.from(digest)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Channel id from a Slack archive URL or `?channel=` on an incoming-webhook URL. */
export function slackChannelIdFromUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.hostname === "slack.com" || u.hostname === "app.slack.com") {
      const match = u.pathname.match(/\/archives\/(C[A-Z0-9]+)/i)
      return match ? match[1] : null
    }
    if (u.hostname === "hooks.slack.com") {
      const channel = u.searchParams.get("channel")
      return channel && /^C[A-Z0-9]+$/i.test(channel) ? channel : null
    }
  } catch {
    return null
  }
  return null
}

export function parseSlackInteractiveBody(raw: string): unknown {
  const payload = new URLSearchParams(raw).get("payload")
  if (!payload) return null
  try {
    return JSON.parse(payload) as unknown
  } catch {
    return null
  }
}

export type SlackDecision = {
  decision: "approve" | "reject"
  approvalId: string
  actor: string
}

export function slackDecisionFromPayload(payload: unknown): SlackDecision | null {
  if (!payload || typeof payload !== "object") return null
  const body = payload as Record<string, unknown>
  if (body.type !== "block_actions") return null
  const actions = body.actions
  if (!Array.isArray(actions) || actions.length === 0) return null
  const action = actions[0]
  if (!action || typeof action !== "object") return null
  const row = action as Record<string, unknown>
  const actionId = typeof row.action_id === "string" ? row.action_id : ""
  const approvalId = typeof row.value === "string" ? row.value.trim() : ""
  if (!approvalId) return null
  const decision =
    actionId === SLACK_APPROVE_ACTION ? "approve" : actionId === SLACK_DENY_ACTION ? "reject" : null
  if (!decision) return null

  const user = body.user
  let actor = "slack"
  if (user && typeof user === "object") {
    const u = user as Record<string, unknown>
    if (typeof u.username === "string" && u.username) actor = u.username
    else if (typeof u.name === "string" && u.name) actor = u.name
    else if (typeof u.id === "string" && u.id) actor = u.id
  }
  return { decision, approvalId, actor: `slack:${actor}` }
}

export function slackInteractivePayload(event: string, data: Record<string, unknown>, text: string): string {
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text } }]
  if (event === "approval.created" || event === "escalation.created") {
    const approvalId = typeof data.approval_id === "string" ? data.approval_id : ""
    const reviewUrl = typeof data.approve_url === "string" ? data.approve_url : REVIEW_URL
    const elements: unknown[] = []
    if (approvalId) {
      elements.push(
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "Approve" },
          action_id: SLACK_APPROVE_ACTION,
          value: approvalId,
        },
        {
          type: "button",
          style: "danger",
          text: { type: "plain_text", text: "Deny" },
          action_id: SLACK_DENY_ACTION,
          value: approvalId,
        },
      )
    }
    elements.push({
      type: "button",
      text: { type: "plain_text", text: "Review in Sanction" },
      url: reviewUrl || REVIEW_URL,
    })
    blocks.push({ type: "actions", elements })
  }
  return JSON.stringify({ text: text.replace(/\*/g, ""), blocks })
}

export function slackReplacementMessage(decision: "approve" | "reject", actor: string): Record<string, unknown> {
  const approved = decision === "approve"
  const label = approved ? "Approved" : "Denied"
  const icon = approved ? ":white_check_mark:" : ":no_entry:"
  const text = `${icon} *${label}* by ${actor.replace(/^slack:/, "")}`
  return {
    replace_original: true,
    text: text.replace(/\*/g, ""),
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  }
}

export async function postSlackChat(channel: string, body: string, token = slackBotToken()): Promise<void> {
  if (!token) return
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const parsed = JSON.parse(body) as { text?: string; blocks?: unknown }
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel,
        text: typeof parsed.text === "string" ? parsed.text : "Sanction",
        blocks: parsed.blocks,
        unfurl_links: false,
        unfurl_media: false,
      }),
      signal: ctrl.signal,
    })
  } catch {
    // best-effort — never throw into the caller's request
  } finally {
    clearTimeout(timer)
  }
}
