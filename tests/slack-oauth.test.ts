import { SignJWT } from "jose"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  issueSlackOAuthState,
  parseSlackOAuthAccess,
  slackAuthorizeUrl,
  slackOAuthLabel,
  slackRedirectUri,
  verifySlackOAuthState,
} from "../lib/slackOAuth"

const SECRET = "test-signing-secret-material"

function validAccess(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    access_token: "xoxb-install",
    team: { id: "T123", name: "Acme" },
    incoming_webhook: { channel_id: "C0123456789", channel: "#approvals" },
    authed_user: { id: "U99" },
    ...over,
  }
}

beforeEach(() => {
  vi.stubEnv("SANCTION_SIGNING_SECRET", SECRET)
  vi.stubEnv("SANCTION_SLACK_CLIENT_ID", "client.123")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("parseSlackOAuthAccess", () => {
  it("accepts a bot token plus incoming-webhook channel", () => {
    expect(parseSlackOAuthAccess(validAccess())).toEqual({
      accessToken: "xoxb-install",
      teamId: "T123",
      teamName: "Acme",
      channelId: "C0123456789",
      channelName: "#approvals",
      slackUserId: "U99",
    })
  })

  it("fails closed on ok:false, missing token, missing team, or missing channel", () => {
    expect(parseSlackOAuthAccess({ ...validAccess(), ok: false })).toBeNull()
    expect(parseSlackOAuthAccess({ ...validAccess(), access_token: "xoxp-user" })).toBeNull()
    expect(parseSlackOAuthAccess({ ...validAccess(), team: null })).toBeNull()
    expect(parseSlackOAuthAccess({ ...validAccess(), incoming_webhook: { channel: "#x" } })).toBeNull()
    expect(parseSlackOAuthAccess({ ...validAccess(), incoming_webhook: { channel_id: "G123" } })).toBeNull()
  })
})

describe("Slack OAuth state", () => {
  it("round-trips a wallet binding", async () => {
    const token = await issueSlackOAuthState("wallet_1")
    expect(await verifySlackOAuthState(token)).toEqual({ walletId: "wallet_1" })
  })

  it("rejects garbage and a JWT with the wrong purpose", async () => {
    expect(await verifySlackOAuthState("not-a-jwt")).toBeNull()
    const other = await new SignJWT({ purpose: "other", wallet: "wallet_1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("sanction")
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(SECRET))
    expect(await verifySlackOAuthState(other)).toBeNull()
  })
})

describe("authorize URL", () => {
  it("pins redirect_uri and the install scopes", () => {
    expect(slackOAuthLabel("T123")).toBe("slack:bot:T123")
    expect(slackRedirectUri("https://getsanction.com")).toBe(
      "https://getsanction.com/api/slack/oauth/callback",
    )
    const url = new URL(slackAuthorizeUrl("https://getsanction.com", "state-token"))
    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize")
    expect(url.searchParams.get("client_id")).toBe("client.123")
    expect(url.searchParams.get("scope")).toBe("chat:write,incoming-webhook")
    expect(url.searchParams.get("redirect_uri")).toBe("https://getsanction.com/api/slack/oauth/callback")
    expect(url.searchParams.get("state")).toBe("state-token")
  })
})
