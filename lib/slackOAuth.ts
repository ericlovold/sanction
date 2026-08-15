import { SignJWT, jwtVerify } from "jose"
import { encryptCredentialEnvelope } from "@/lib/credentialCrypto"
import { withTenant } from "@/lib/rls"

const SLACK_OAUTH_PURPOSE = "slack-oauth"
const SLACK_OAUTH_TTL_SECONDS = 600
const SLACK_SCOPES = "chat:write,incoming-webhook"
const SLACK_INSTALL_EVENTS = [
  "approval.created",
  "approval.resolved",
  "escalation.created",
  "escalation.resolved",
  "budget.threshold",
]

export function slackClientId(): string | undefined {
  const id = process.env.SANCTION_SLACK_CLIENT_ID
  return id && id.length > 0 ? id : undefined
}

export function slackClientSecret(): string | undefined {
  const secret = process.env.SANCTION_SLACK_CLIENT_SECRET
  return secret && secret.length > 0 ? secret : undefined
}

export function slackOAuthLabel(teamId: string): string {
  return `slack:bot:${teamId}`
}

export function slackRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/slack/oauth/callback`
}

function signingKey() {
  const secret = process.env.SANCTION_SIGNING_SECRET
  if (!secret) throw new Error("SANCTION_SIGNING_SECRET not set")
  return new TextEncoder().encode(secret)
}

export async function issueSlackOAuthState(walletId: string): Promise<string> {
  return new SignJWT({ purpose: SLACK_OAUTH_PURPOSE, wallet: walletId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("sanction")
    .setIssuedAt()
    .setExpirationTime(`${SLACK_OAUTH_TTL_SECONDS}s`)
    .sign(signingKey())
}

export async function verifySlackOAuthState(token: string): Promise<{ walletId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      issuer: "sanction",
      algorithms: ["HS256"],
    })
    if (payload.purpose !== SLACK_OAUTH_PURPOSE) return null
    if (typeof payload.wallet !== "string" || !payload.wallet) return null
    return { walletId: payload.wallet }
  } catch {
    return null
  }
}

export function slackAuthorizeUrl(origin: string, state: string): string {
  const clientId = slackClientId()
  if (!clientId) throw new Error("SANCTION_SLACK_CLIENT_ID not set")
  const params = new URLSearchParams({
    client_id: clientId,
    scope: SLACK_SCOPES,
    redirect_uri: slackRedirectUri(origin),
    state,
  })
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`
}

export type SlackOAuthAccess = {
  accessToken: string
  teamId: string
  teamName: string | null
  channelId: string
  channelName: string | null
  slackUserId: string | null
}

export function parseSlackOAuthAccess(json: unknown): SlackOAuthAccess | null {
  if (!json || typeof json !== "object") return null
  const body = json as Record<string, unknown>
  if (body.ok !== true) return null
  if (typeof body.access_token !== "string" || !body.access_token.startsWith("xoxb-")) return null

  const team = body.team
  if (!team || typeof team !== "object") return null
  const teamRow = team as Record<string, unknown>
  if (typeof teamRow.id !== "string" || !teamRow.id) return null

  const hook = body.incoming_webhook
  if (!hook || typeof hook !== "object") return null
  const hookRow = hook as Record<string, unknown>
  if (typeof hookRow.channel_id !== "string" || !/^C[A-Z0-9]+$/i.test(hookRow.channel_id)) return null

  const authed = body.authed_user
  let slackUserId: string | null = null
  if (authed && typeof authed === "object") {
    const u = authed as Record<string, unknown>
    if (typeof u.id === "string" && u.id) slackUserId = u.id
  }

  return {
    accessToken: body.access_token,
    teamId: teamRow.id,
    teamName: typeof teamRow.name === "string" && teamRow.name ? teamRow.name : null,
    channelId: hookRow.channel_id,
    channelName: typeof hookRow.channel === "string" && hookRow.channel ? hookRow.channel : null,
    slackUserId,
  }
}

export async function exchangeSlackCode(code: string, redirectUri: string): Promise<SlackOAuthAccess | null> {
  const clientId = slackClientId()
  const clientSecret = slackClientSecret()
  if (!clientId || !clientSecret) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }).toString(),
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    return parseSlackOAuthAccess(await res.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function upsertSlackInstall(
  walletId: string,
  access: SlackOAuthAccess,
): Promise<{ channelId: string; token: string }> {
  const label = slackOAuthLabel(access.teamId)
  const { blob, keyId } = await encryptCredentialEnvelope(access.accessToken, walletId, label)
  await withTenant(walletId, (tx) =>
    tx.slackInstall.upsert({
      where: { walletId_teamId: { walletId, teamId: access.teamId } },
      create: {
        walletId,
        teamId: access.teamId,
        teamName: access.teamName,
        channelId: access.channelId,
        channelName: access.channelName,
        botTokenEnc: blob,
        keyId,
        slackUserId: access.slackUserId,
        events: [...SLACK_INSTALL_EVENTS],
      },
      update: {
        teamName: access.teamName,
        channelId: access.channelId,
        channelName: access.channelName,
        botTokenEnc: blob,
        keyId,
        slackUserId: access.slackUserId,
        revokedAt: null,
        installedAt: new Date(),
      },
    }),
  )
  return { channelId: access.channelId, token: access.accessToken }
}
