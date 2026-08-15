import { NextRequest, NextResponse } from "next/server"
import { hasRole } from "@/lib/roles"
import { publicOrigin } from "@/lib/authzen"
import { clientIp, rateLimit } from "@/lib/rateLimit"
import { getSessionMember } from "@/lib/session"
import { issueSlackOAuthState, slackAuthorizeUrl, slackClientId } from "@/lib/slackOAuth"

const NO_STORE = { "Cache-Control": "no-store" } as const

function redirectTo(url: string) {
  return NextResponse.redirect(url, { headers: NO_STORE })
}

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req)
  const clientId = slackClientId()
  if (!clientId) {
    return NextResponse.json({ error: "Slack OAuth is not configured" }, { status: 503, headers: NO_STORE })
  }

  const rl = await rateLimit("slack_oauth_start", clientIp(req), 20, 60)
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60), ...NO_STORE } },
    )
  }

  const member = await getSessionMember()
  if (!member) {
    return redirectTo(`${origin}/login?next=${encodeURIComponent("/dashboard/approvals")}`)
  }
  if (!hasRole(member.role, "admin")) {
    return redirectTo(`${origin}/dashboard/approvals?slack=forbidden`)
  }

  const state = await issueSlackOAuthState(member.wallet.id)
  return redirectTo(slackAuthorizeUrl(origin, state))
}
