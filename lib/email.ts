// Minimal transactional email via Resend's REST API (no SDK dependency).
// If RESEND_API_KEY is unset, falls back to logging the message server-side so
// flows are testable in dev without an email provider.

const RESEND_API_KEY = process.env.RESEND_API_KEY
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Sanction <no-reply@getsanction.com>"

type SendArgs = { to: string; subject: string; html: string; text: string }

async function send({ to, subject, html, text }: SendArgs): Promise<void> {
  if (!RESEND_API_KEY) {
    // Dev fallback — surfaces the content (incl. any link) in the server log.
    console.log(`[email:dev] to=${to} subject=${JSON.stringify(subject)}\n${text}`)
    return
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, html, text }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Resend send failed: ${res.status} ${body}`)
  }
}

// Notify the founder when someone joins the list — direct visibility on every
// new lead. Best-effort; fired from after() so it never blocks the signup.
const LEADS_NOTIFY_TO = process.env.LEADS_NOTIFY_TO ?? "eric@getsanction.com"

// Welcome the person who just joined the list — a real message from Sanction,
// so a signup is confirmed, not silent. Best-effort; fired from after().
export async function sendLeadWelcomeEmail(to: string): Promise<void> {
  const subject = "You're on the list — Sanction"
  const text = [
    "Thanks for signing up.",
    "",
    "Sanction is the authorization layer for AI agents — one key that governs what an agent may spend, invoke, and provision, with a human in the loop over the line and every decision on the record.",
    "",
    "You'll get launch updates and early access as we ship. One email when it matters — no spam, unsubscribe anytime.",
    "",
    "Explore what's live: https://getsanction.com",
    "",
    "— Eric, founder",
  ].join("\n")
  const html = `<!doctype html><html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#e4e4e7">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px">
    <p style="font-size:18px;font-weight:600;letter-spacing:-0.01em;margin:0 0 24px">Sanction</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Thanks for signing up.</p>
    <p style="font-size:14px;line-height:1.6;color:#a1a1aa;margin:0 0 16px">Sanction is the authorization layer for AI agents — one key that governs what an agent may spend, invoke, and provision, with a human in the loop over the line and every decision on the record.</p>
    <p style="font-size:14px;line-height:1.6;color:#a1a1aa;margin:0 0 24px">You'll get launch updates and early access as we ship. One email when it matters — no spam, unsubscribe anytime.</p>
    <a href="https://getsanction.com" style="display:inline-block;background:#10b981;color:#09090b;font-weight:600;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:8px">Explore Sanction</a>
    <p style="font-size:13px;line-height:1.6;color:#71717a;margin:28px 0 0">— Eric, founder</p>
  </div></body></html>`
  await send({ to, subject, html, text })
}

export async function sendNewLeadEmail(lead: { email: string; source: string }): Promise<void> {
  const subject = `New Sanction signup: ${lead.email}`
  const text = [`${lead.email} just joined the Sanction list.`, "", `Source: ${lead.source}`, `When: ${new Date().toISOString()}`].join("\n")
  const html = `<!doctype html><html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#e4e4e7">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px">
    <p style="font-size:18px;font-weight:600;letter-spacing:-0.01em;margin:0 0 24px">Sanction</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 8px"><strong>${lead.email}</strong> just joined the list.</p>
    <p style="font-size:13.5px;line-height:1.6;color:#a1a1aa;margin:0">Source: ${lead.source}</p>
  </div></body></html>`
  await send({ to: LEADS_NOTIFY_TO, subject, html, text })
}

export async function sendMagicLinkEmail(to: string, link: string): Promise<void> {
  const subject = "Your Sanction sign-in link"
  const text = [
    "Sign in to Sanction by opening this link (valid for 15 minutes):",
    "",
    link,
    "",
    "This issues a fresh management key and signs you in — your previous key will stop working.",
    "If you didn't request this, you can ignore this email.",
  ].join("\n")
  const html = `<!doctype html><html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#e4e4e7">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px">
    <p style="font-size:18px;font-weight:600;letter-spacing:-0.01em;margin:0 0 24px">Sanction</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 24px">Click below to sign in. The link is valid for 15 minutes.</p>
    <a href="${link}" style="display:inline-block;background:#10b981;color:#09090b;font-weight:600;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:8px">Sign in to Sanction</a>
    <p style="font-size:13px;line-height:1.6;color:#a1a1aa;margin:24px 0 0">This issues a fresh management key (<code>sk_…</code>) and signs you in — your previous key will stop working. If you didn't request this, ignore this email.</p>
    <p style="font-size:12px;color:#52525b;margin:24px 0 0;word-break:break-all">${link}</p>
  </div></body></html>`
  await send({ to, subject, html, text })
}

type BudgetThreshold = {
  label: string
  pctUsed: number
  spentUsd: number
  capUsd: number
}

const SPEND_URL = "https://getsanction.com/dashboard/spend"

// Early warning at the threshold line (default 80%) — the "no surprises"
// email. Fires once per scope per day, before anything is denied. Best-effort;
// callers fire from after().
export async function sendBudgetThresholdEmail(to: string, b: BudgetThreshold): Promise<void> {
  const spent = `$${b.spentUsd.toFixed(2)}`
  const cap = `$${b.capUsd.toFixed(2)}`
  const subject = `Heads up: ${b.pctUsed}% of today's budget — ${b.label}`
  const text = [
    `${b.label} is at ${b.pctUsed}% of today's budget: ${spent} of ${cap}.`,
    "",
    "Nothing is blocked yet — this is the early warning so nothing surprises you.",
    "If the pace holds, requests over the limit will be denied until the daily reset.",
    "",
    `Review the burn: ${SPEND_URL}`,
  ].join("\n")
  const html = `<!doctype html><html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#e4e4e7">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px">
    <p style="font-size:18px;font-weight:600;letter-spacing:-0.01em;margin:0 0 24px">Sanction</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 8px"><strong>${b.label}</strong> is at <strong>${b.pctUsed}%</strong> of today's budget: <strong>${spent}</strong> of <strong>${cap}</strong>.</p>
    <p style="font-size:14px;line-height:1.6;color:#a1a1aa;margin:8px 0 24px">Nothing is blocked yet — this is the early warning. If the pace holds, requests over the limit will be denied until the daily reset.</p>
    <a href="${SPEND_URL}" style="display:inline-block;background:#10b981;color:#09090b;font-weight:600;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:8px">Review the burn</a>
    <p style="font-size:12px;color:#52525b;margin:24px 0 0;word-break:break-all">${SPEND_URL}</p>
  </div></body></html>`
  await send({ to, subject, html, text })
}

type Escalation = {
  agentName: string
  amountUsd: number
  merchant: string
  category: string
  description?: string | null
  approveUrl: string
}

// Notify the wallet owner when an agent's spend escalates and needs a human
// decision — the make-or-break human-in-the-loop moment. Best-effort; callers
// fire this from `after()` so a send failure never affects the API response.
export async function sendEscalationEmail(to: string, e: Escalation): Promise<void> {
  const amount = `$${e.amountUsd.toFixed(2)}`
  const subject = `Approval needed: ${amount} at ${e.merchant}`
  const text = [
    `${e.agentName} is requesting approval to spend ${amount} at ${e.merchant} (${e.category}).`,
    ...(e.description ? ["", e.description] : []),
    "",
    `Approve or reject: ${e.approveUrl}`,
    "",
    "Until you decide, the charge is paused. This is Sanction holding the line.",
  ].join("\n")
  const html = `<!doctype html><html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#e4e4e7">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px">
    <p style="font-size:18px;font-weight:600;letter-spacing:-0.01em;margin:0 0 24px">Sanction</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 8px"><strong>${e.agentName}</strong> wants to spend <strong>${amount}</strong> at <strong>${e.merchant}</strong> <span style="color:#a1a1aa">(${e.category})</span>.</p>
    ${e.description ? `<p style="font-size:14px;line-height:1.6;color:#a1a1aa;margin:0 0 16px">${e.description}</p>` : ""}
    <p style="font-size:14px;line-height:1.6;margin:8px 0 24px">The charge is paused until you decide.</p>
    <a href="${e.approveUrl}" style="display:inline-block;background:#10b981;color:#09090b;font-weight:600;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:8px">Review &amp; decide</a>
    <p style="font-size:12px;color:#52525b;margin:24px 0 0;word-break:break-all">${e.approveUrl}</p>
  </div></body></html>`
  await send({ to, subject, html, text })
}
