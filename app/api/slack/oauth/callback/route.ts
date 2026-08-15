import { NextRequest, NextResponse } from "next/server"
import { publicOrigin } from "@/lib/authzen"
import { clientIp, rateLimit } from "@/lib/rateLimit"
import { hasRole } from "@/lib/roles"
import { getSessionMember } from "@/lib/session"
import { postSlackChat } from "@/lib/slack"
import {
  exchangeSlackCode,
  slackRedirectUri,
  upsertSlackInstall,
  verifySlackOAuthState,
} from "@/lib/slackOAuth"
import { slackPayload } from "@/lib/webhooks"

const NO_STORE = { "Cache-Control": "no-store" } as const

function redirectTo(url: string) {
  return NextResponse.redirect(url, { headers: NO_STORE })
}

function approvals(origin: string, slack: string) {
  return redirectTo(`${origin}/dashboard/approvals?slack=${slack}`)
}

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req)
  const error = req.nextUrl.searchParams.get("error")
  if (error === "access_denied") return approvals(origin, "denied")
  if (error) return approvals(origin, "failed")

  const rl = await rateLimit("slack_oauth_callback", clientIp(req), 20, 60)
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
  if (!hasRole(member.role, "admin")) return approvals(origin, "forbidden")

  const stateParam = req.nextUrl.searchParams.get("state") ?? ""
  const code = req.nextUrl.searchParams.get("code") ?? ""
  const state = stateParam ? await verifySlackOAuthState(stateParam) : null
  if (!state || state.walletId !== member.wallet.id || !code) return approvals(origin, "invalid")

  const access = await exchangeSlackCode(code, slackRedirectUri(origin))
  if (!access) return approvals(origin, "failed")

  const { channelId, token } = await upsertSlackInstall(member.wallet.id, access)
  await postSlackChat(channelId, slackPayload("ping", {}), token)
  return approvals(origin, "connected")
}
