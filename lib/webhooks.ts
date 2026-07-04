import { createHmac, randomBytes } from "crypto"
import { db } from "./db"

// Owner-registered webhooks notified on events. Each delivery is signed with
// HMAC-SHA256 over the exact request body so the receiver can verify it's us.

export const APPROVE_URL = "https://getsanction.com/dashboard/approvals"

// The event catalog — one source of truth for the API route, the dashboard
// form, and the docs. "*" subscribes to everything, present and future.
export const KNOWN_EVENTS = [
  "approval.created",
  "approval.resolved",
  "escalation.created",
  "escalation.resolved",
  "budget.exhausted",
  "budget.threshold",
  "*",
] as const
export const DEFAULT_EVENTS = [
  "approval.created",
  "approval.resolved",
  "escalation.created",
  "escalation.resolved",
  "budget.threshold",
]

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`
}

// Reject loopback / private / metadata hosts — the server fetches this URL, so
// an unguarded one is an SSRF vector.
export function isPublicHttpsUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== "https:") return false
  const h = u.hostname.toLowerCase()
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false
  if (/^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false
  if (h === "0.0.0.0" || h === "::1" || h === "[::1]") return false
  return true
}

export function signBody(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex")
}

async function post(url: string, secret: string | null, event: string, body: string) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "Sanction-Webhook/1",
      "x-sanction-event": event,
    }
    // Slack deliveries carry no HMAC — the webhook URL is Slack's own secret.
    if (secret !== null) headers["x-sanction-signature"] = signBody(secret, body)
    await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: ctrl.signal,
    })
  } catch {
    // best-effort delivery — never throw into the caller's request
  } finally {
    clearTimeout(timer)
  }
}

// ── Slack (approvals that find you) ─────────────────────────────────────────
// A Slack incoming-webhook URL registered as a Sanction webhook gets a
// human-readable Block Kit message instead of the raw signed JSON — the same
// events, formatted for the place the human actually is. The Slack URL itself
// is the shared secret (Slack's model), so these deliveries skip the HMAC
// header; machine consumers keep the signed raw payload.
export function isSlackWebhookUrl(raw: string): boolean {
  try {
    return new URL(raw).hostname === "hooks.slack.com"
  } catch {
    return false
  }
}

function slackText(event: string, data: Record<string, unknown>): string {
  const s = (k: string) => (typeof data[k] === "string" && (data[k] as string).trim() ? (data[k] as string) : null)
  const n = (k: string) => (typeof data[k] === "number" && Number.isFinite(data[k] as number) ? (data[k] as number) : null)
  const money = (v: number | null) => (v === null ? null : `$${v.toFixed(2)}`)

  switch (event) {
    case "approval.created":
    case "escalation.created": {
      const agent = s("agent") ?? "An agent"
      const amount = money(n("amount_usd"))
      const what = s("merchant") ?? s("line_item") ?? s("tool") ?? "an action"
      return `:hourglass_flowing_sand: *${agent}* needs approval${amount ? ` for *${amount}*` : ""} — ${what}${s("reason") ? `\n_${s("reason")}_` : ""}`
    }
    case "approval.resolved":
    case "escalation.resolved": {
      const status = s("status") ?? "resolved"
      const icon = status === "approved" ? ":white_check_mark:" : ":no_entry:"
      return `${icon} Approval *${status}* for *${s("agent") ?? "agent"}*${s("note") ? ` — ${s("note")}` : ""}`
    }
    case "budget.threshold": {
      const pct = n("pct_used")
      const scope = s("scope") ?? "budget"
      const who = s("agent") ?? s("pool") ?? "wallet"
      return `:warning: *${who}* has used *${pct !== null ? Math.round(pct) : "80+"}%* of its ${scope.replace(/_/g, " ")} (${money(n("spent_usd")) ?? "?"} of ${money(n("cap_usd")) ?? "?"})`
    }
    case "budget.exhausted":
      return `:octagonal_sign: *${s("agent") ?? "An agent"}* exhausted its ${(s("scope") ?? "daily spend").replace(/_/g, " ")} budget — further requests deny.`
    case "ping":
      return ":white_check_mark: Sanction connected. Escalations and budget alerts will land here."
    default:
      return `Sanction event: ${event}`
  }
}

export function slackPayload(event: string, data: Record<string, unknown>): string {
  const text = slackText(event, data)
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text } }]
  if (event === "approval.created" || event === "escalation.created") {
    blocks.push({
      type: "actions",
      elements: [
        { type: "button", style: "primary", text: { type: "plain_text", text: "Review in Sanction" }, url: APPROVE_URL },
      ],
    })
  }
  return JSON.stringify({ text: text.replace(/\*/g, ""), blocks })
}

/** Deliver an event to every active webhook on the wallet subscribed to it. */
export async function deliverEvent(walletId: string, event: string, data: Record<string, unknown>) {
  const hooks = await db.webhook.findMany({ where: { walletId, isActive: true } })
  const targets = hooks.filter((h) => h.events.includes(event) || h.events.includes("*"))
  if (targets.length === 0) return
  const body = JSON.stringify({ event, created_at: new Date().toISOString(), wallet_id: walletId, ...data })
  await Promise.allSettled(
    targets.map((h) =>
      isSlackWebhookUrl(h.url) ? post(h.url, null, event, slackPayload(event, data)) : post(h.url, h.secret, event, body),
    ),
  )
}

/** Send a one-off test ping to a single endpoint (used when a webhook is created). */
export async function deliverPing(url: string, secret: string) {
  if (isSlackWebhookUrl(url)) {
    await post(url, null, "ping", slackPayload("ping", {}))
    return
  }
  const body = JSON.stringify({ event: "ping", created_at: new Date().toISOString(), message: "Sanction webhook connected." })
  await post(url, secret, "ping", body)
}
