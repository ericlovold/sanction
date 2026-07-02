import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"

export const dynamic = "force-dynamic"

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Email pipeline health check. Owner-only (x-admin-secret). Does a LIVE Resend
 * send and returns the actual result, so a mis-set key or an unverified sending
 * domain surfaces as a clear error instead of the silent fire-and-forget failure
 * every real send() uses. Never returns the key value — only a masked prefix.
 *
 *   curl -H "x-admin-secret: <SANCTION_ADMIN_SECRET>" \
 *     "https://getsanction.com/api/admin/email-check?to=you@example.com"
 */
export async function GET(req: NextRequest) {
  const adminSecret = process.env.SANCTION_ADMIN_SECRET
  if (!adminSecret) {
    return NextResponse.json({ error: "Disabled: SANCTION_ADMIN_SECRET not configured" }, { status: 503 })
  }
  if (!constantTimeEqual(req.headers.get("x-admin-secret") ?? "", adminSecret)) {
    return NextResponse.json({ error: "Invalid admin secret" }, { status: 401 })
  }

  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? "Sanction <no-reply@getsanction.com>"
  const to = req.nextUrl.searchParams.get("to") || process.env.LEADS_NOTIFY_TO || "eric@getsanction.com"

  const diag = {
    resend_key_present: !!key,
    resend_key_prefix: key ? `${key.slice(0, 5)}…${key.slice(-2)}` : null,
    email_from: from,
    attempted_to: to,
  }

  if (!key) {
    return NextResponse.json(
      { ...diag, ok: false, verdict: "RESEND_API_KEY is not set — emails only log to the server, none are delivered." },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    )
  }

  // Live send straight to Resend so we see the true status/body.
  let status: number
  let body: string
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: "Sanction email health check",
        text: "This is a Sanction email pipeline test. If you received it, delivery works.",
      }),
    })
    status = res.status
    body = await res.text().catch(() => "")
  } catch (e) {
    return NextResponse.json(
      { ...diag, ok: false, verdict: `Network error reaching Resend: ${e instanceof Error ? e.message : String(e)}` },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    )
  }

  const ok = status >= 200 && status < 300
  const verdict = ok
    ? `Sent. Check ${to}. Key and sending domain are working.`
    : status === 401 || status === 403
      ? `Resend rejected the request (${status}). Likely a bad/expired API key OR the sending domain in "${from}" isn't verified in this Resend account.`
      : status === 422
        ? `Resend validation error (422) — usually the "from" domain isn't verified. Verify getsanction.com in Resend, or set EMAIL_FROM to a verified domain.`
        : `Resend returned ${status}.`

  return NextResponse.json({ ...diag, ok, resend_status: status, resend_body: body.slice(0, 500), verdict }, { status: 200, headers: { "Cache-Control": "no-store" } })
}
