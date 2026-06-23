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
