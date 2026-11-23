import { spendReturnPath } from "@/lib/returnPath"
// Minimal transactional email via Resend's REST API (no SDK dependency).
// Non-sign-in messages retain a development logging fallback. Sign-in senders
// require the provider so their credential URLs never reach that logger.

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
  if (!RESEND_API_KEY) throw new Error("Recovery email delivery is not configured")
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

type Invite = {
  walletName: string
  role: string // display label, e.g. "Admin" — not the raw "owner"|"admin"|"viewer"
  inviterName: string
  link: string
}

// Invite a teammate into an existing wallet (WALLET-MEMBERS). Same shape as
// sendMagicLinkEmail — a single link, short validity window, no account
// existence implied either way (the invite already names the wallet, so
// there's nothing to hide here).
export async function sendInviteEmail(to: string, i: Invite): Promise<void> {
  const subject = `${i.inviterName} invited you to ${i.walletName} on Sanction`
  const text = [
    `${i.inviterName} invited you to join ${i.walletName} on Sanction as ${i.role}.`,
    "",
    "Accept the invite (valid for 7 days):",
    "",
    i.link,
    "",
    "This signs you in with your Google or GitHub account — team members use their own login, not a shared key.",
    "If you weren't expecting this, you can ignore this email.",
  ].join("\n")
  const html = `<!doctype html><html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#e4e4e7">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px">
    <p style="font-size:18px;font-weight:600;letter-spacing:-0.01em;margin:0 0 24px">Sanction</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 24px"><strong>${i.inviterName}</strong> invited you to join <strong>${i.walletName}</strong> as <strong>${i.role}</strong>.</p>
    <a href="${i.link}" style="display:inline-block;background:#10b981;color:#09090b;font-weight:600;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:8px">Accept invite</a>
    <p style="font-size:13px;line-height:1.6;color:#a1a1aa;margin:24px 0 0">Signs you in with your Google or GitHub account — team members use their own login, not a shared key. If you weren't expecting this, ignore this email.</p>
    <p style="font-size:12px;color:#52525b;margin:24px 0 0;word-break:break-all">${i.link}</p>
  </div></body></html>`
  await send({ to, subject, html, text })
}

type BudgetThreshold = {
  walletId: string
  agent?: string
  scope?: string
  label: string
  pctUsed: number
  spentUsd: number
  capUsd: number
}

// Early warning at the threshold line (default 80%) — the "no surprises"
// email. Best-effort notification of a threshold crossing;
// callers fire from after().
export async function sendBudgetThresholdEmail(to: string, b: BudgetThreshold): Promise<void> {
  const spendUrl = `https://getsanction.com${spendReturnPath(b.walletId, b.agent, b.scope)}`
  const spent = `$${b.spentUsd.toFixed(2)}`
  const cap = `$${b.capUsd.toFixed(2)}`
  const subject = `Heads up: ${b.pctUsed}% of today's budget — ${b.label}`
  const text = [
    `${b.label} is at ${b.pctUsed}% of today's budget: ${spent} of ${cap}.`,
    "",
    "This budget is approaching its limit.",
    "Requests that would exceed the limit are denied until the daily reset.",
    "",
    `Review the burn: ${spendUrl}`,
  ].join("\n")
  const html = `<!doctype html><html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#e4e4e7">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px">
    <p style="font-size:18px;font-weight:600;letter-spacing:-0.01em;margin:0 0 24px">Sanction</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 8px"><strong>${escapeHtml(b.label)}</strong> is at <strong>${b.pctUsed}%</strong> of today's budget: <strong>${spent}</strong> of <strong>${cap}</strong>.</p>
    <p style="font-size:14px;line-height:1.6;color:#a1a1aa;margin:8px 0 24px">This budget is approaching its limit. Requests that would exceed the limit are denied until the daily reset.</p>
    <a href="${escapeHtml(spendUrl)}" style="display:inline-block;background:#10b981;color:#09090b;font-weight:600;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:8px">Review the burn</a>
    <p style="font-size:12px;color:#52525b;margin:24px 0 0;word-break:break-all">${escapeHtml(spendUrl)}</p>
  </div></body></html>`
  await send({ to, subject, html, text })
}

type Escalation = {
  actionType?: "tool.invoke"
  reason?: string | null
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
  const tool = e.actionType === "tool.invoke"
  const subject = tool ? `Approval needed: ${e.merchant}` : `Approval needed: ${amount} at ${e.merchant}`
  const summary = tool
    ? `${e.agentName} is requesting approval to invoke ${e.merchant}.`
    : `${e.agentName} is requesting approval to spend ${amount} at ${e.merchant} (${e.category}).`
  const waiting = "This request needs your decision. Approval issues a single-use grant for the agent to redeem; it does not execute the action."
  const text = [
    summary,
    ...(e.description ? ["", e.description] : []),
    ...(e.reason && e.reason !== e.description ? ["", `Why approval is needed: ${e.reason}`] : []),
    "",
    `Approve or reject: ${e.approveUrl}`,
    "",
    waiting,
  ].join("\n")
  const html = `<!doctype html><html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#e4e4e7">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px">
    <p style="font-size:18px;font-weight:600;letter-spacing:-0.01em;margin:0 0 24px">Sanction</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 8px">${escapeHtml(summary)}</p>
    ${e.description ? `<p style="font-size:14px;line-height:1.6;color:#a1a1aa;margin:0 0 16px">${escapeHtml(e.description)}</p>` : ""}
    ${e.reason && e.reason !== e.description ? `<p>Why approval is needed: ${escapeHtml(e.reason)}</p>` : ""}
    <p style="font-size:14px;line-height:1.6;margin:8px 0 24px">${waiting}</p>
    <a href="${e.approveUrl}" style="display:inline-block;background:#10b981;color:#09090b;font-weight:600;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:8px">Review &amp; decide</a>
    <p style="font-size:12px;color:#52525b;margin:24px 0 0;word-break:break-all">${e.approveUrl}</p>
  </div></body></html>`
  await send({ to, subject, html, text })
}

type UsageAlertEmail = {
  walletName: string
  alerts: {
    rule: string
    provider: string
    subjectType: string
    subjectKey: string
    windowStart: Date
    windowEnd: Date
    observedNanos: bigint
    thresholdNanos: bigint
    evidence: { identity: string; billedNanos: string }
  }[]
}

const USAGE_RULE_LABEL: Record<string, string> = {
  runaway_rate: "Spend spiked far above this person's normal hour",
  headless_burn: "Background work kept spending with nobody at the keyboard",
  daily_cap: "One person passed the daily spend line",
}

// One email per pull, listing every guardrail that newly fired. The numbers
// come from provider reporting, so the email says how old they are and that
// nothing was stopped: an alert implying Sanction blocked the spend would be
// false. Best-effort; the sync never fails on a send error.
export async function sendUsageAlertEmail(to: string, a: UsageAlertEmail): Promise<void> {
  const url = "https://getsanction.com/dashboard/ai-spend"
  const dollars = (nanos: bigint) => `$${(Number(nanos) / 1e9).toFixed(2)}`
  const hour = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`
  const lines = a.alerts.map((x) => ({
    title: USAGE_RULE_LABEL[x.rule] ?? x.rule,
    who: x.subjectType === "person" ? x.evidence.identity : `${x.subjectType} ${x.subjectKey} (${x.evidence.identity})`,
    amount: `${dollars(x.observedNanos)} in ${x.provider} usage between ${hour(x.windowStart)} and ${hour(x.windowEnd)}, against a line of ${dollars(x.thresholdNanos)}. Billed so far: ${dollars(BigInt(x.evidence.billedNanos))}.`,
  }))
  const subject = lines.length === 1 ? `AI spend alert: ${lines[0].title}` : `${lines.length} AI spend alerts for ${a.walletName}`
  const note =
    "These numbers come from the provider's own reporting, which runs about an hour behind. Sanction has not stopped anything: this tool is connected for visibility, so stopping the job happens in the tool itself."
  const text = [...lines.flatMap((l) => [l.title, l.who, l.amount, ""]), note, "", `See the evidence: ${url}`].join("\n")
  const html = `<!doctype html><html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#e4e4e7">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px">
    <p style="font-size:18px;font-weight:600;letter-spacing:-0.01em;margin:0 0 24px">Sanction</p>
    ${lines
      .map(
        (l) => `<p style="font-size:15px;line-height:1.6;margin:0 0 4px"><strong>${escapeHtml(l.title)}</strong></p>
    <p style="font-size:14px;line-height:1.6;margin:0 0 4px">${escapeHtml(l.who)}</p>
    <p style="font-size:14px;line-height:1.6;color:#a1a1aa;margin:0 0 20px">${escapeHtml(l.amount)}</p>`,
      )
      .join("\n    ")}
    <p style="font-size:13px;line-height:1.6;color:#a1a1aa;margin:8px 0 24px">${escapeHtml(note)}</p>
    <a href="${url}" style="display:inline-block;background:#10b981;color:#09090b;font-weight:600;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:8px">See the evidence</a>
  </div></body></html>`
  await send({ to, subject, html, text })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

// Identity links must never use the development logger: their URL is a credential.
export async function sendIdentitySignInEmail(to: string, link: string): Promise<void> {
  if (!RESEND_API_KEY) throw new Error("Identity email delivery is not configured")
  const text = `Open this link, then select Confirm sign in. It expires in 15 minutes.\n\n${link}\n\nIf you did not request this, ignore this email.`
  const escaped = link.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  await send({ to, subject: "Confirm your Sanction sign-in", text, html: `<p>Confirm your Sanction sign-in. This link expires in 15 minutes.</p><p><a href="${escaped}">Continue to sign in</a></p><p>If you did not request this, ignore this email.</p>` })
}
