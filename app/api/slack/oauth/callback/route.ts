import { NextRequest, NextResponse } from "next/server"
import { publicOrigin } from "@/lib/authzen"
import { clientIp, rateLimit } from "@/lib/rateLimit"
import { hasRole } from "@/lib/roles"
import { getSessionMember } from "@/lib/session"
import { joinSlackChannel, postSlackChat } from "@/lib/slack"
import {
  exchangeSlackCode,
  reconcileSlackDelivery,
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

  const result = await exchangeSlackCode(code, slackRedirectUri(origin))
  if (!result.ok) return approvals(origin, `oauth_${result.error}`)

  const { channelId, token, install } = await upsertSlackInstall(member.wallet.id, result.access)
  let delivery = await postSlackChat(channelId, slackPayload("ping", {}), token)
  if (!delivery.ok && delivery.error === "not_in_channel") {
    const joined = await joinSlackChannel(channelId, token)
    if (!joined.ok) {
      const revoked = await reconcileSlackDelivery(member.wallet.id, install, joined)
      return approvals(origin, revoked ? "token_unavailable" : "not_in_channel")
    }
    // Only an explicit membership rejection is safe to retry, once after joining.
    delivery = await postSlackChat(channelId, slackPayload("ping", {}), token)
  }
  const revoked = await reconcileSlackDelivery(member.wallet.id, install, delivery)
  if (!delivery.ok && delivery.error === "not_in_channel") return approvals(origin, "not_in_channel")
  if (!delivery.ok) return approvals(origin, revoked ? "token_unavailable" : "confirmation_failed")
  return approvals(origin, "connected")
}
