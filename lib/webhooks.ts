import { createHmac, randomBytes } from "crypto"
import { db } from "./db"

// Owner-registered webhooks notified on events. Each delivery is signed with
// HMAC-SHA256 over the exact request body so the receiver can verify it's us.

export const APPROVE_URL = "https://onesanction.com/dashboard/approvals"

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

async function post(url: string, secret: string, event: string, body: string) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Sanction-Webhook/1",
        "x-sanction-event": event,
        "x-sanction-signature": signBody(secret, body),
      },
      body,
      signal: ctrl.signal,
    })
  } catch {
    // best-effort delivery — never throw into the caller's request
  } finally {
    clearTimeout(timer)
  }
}

/** Deliver an event to every active webhook on the wallet subscribed to it. */
export async function deliverEvent(walletId: string, event: string, data: Record<string, unknown>) {
  const hooks = await db.webhook.findMany({ where: { walletId, isActive: true } })
  const targets = hooks.filter((h) => h.events.includes(event) || h.events.includes("*"))
  if (targets.length === 0) return
  const body = JSON.stringify({ event, created_at: new Date().toISOString(), wallet_id: walletId, ...data })
  await Promise.allSettled(targets.map((h) => post(h.url, h.secret, event, body)))
}

/** Send a one-off test ping to a single endpoint (used when a webhook is created). */
export async function deliverPing(url: string, secret: string) {
  const body = JSON.stringify({ event: "ping", created_at: new Date().toISOString(), message: "Sanction webhook connected." })
  await post(url, secret, "ping", body)
}
