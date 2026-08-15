import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { sessionMock, rateLimitMock, encryptMock, upsertMock } = vi.hoisted(() => ({
  sessionMock: { getSessionMember: vi.fn() },
  rateLimitMock: vi.fn(),
  encryptMock: vi.fn(async () => ({ blob: "enc-blob", keyId: "key_1" })),
  upsertMock: vi.fn(async () => ({ id: "si_1" })),
}))

vi.mock("@/lib/session", () => sessionMock)
vi.mock("@/lib/rateLimit", async (orig) => {
  const mod = await orig<typeof import("../lib/rateLimit")>()
  return { ...mod, rateLimit: rateLimitMock }
})
vi.mock("@/lib/credentialCrypto", () => ({ encryptCredentialEnvelope: encryptMock }))
vi.mock("@/lib/rls", () => ({
  withTenant: vi.fn(async (_wallet: string, fn: (tx: { slackInstall: { upsert: typeof upsertMock } }) => unknown) =>
    fn({ slackInstall: { upsert: upsertMock } }),
  ),
}))
vi.mock("@/lib/db", () => ({ db: {} }))

import { GET as slackOAuthStart } from "../app/api/slack/oauth/start/route"
import { GET as slackOAuthCallback } from "../app/api/slack/oauth/callback/route"
import { issueSlackOAuthState } from "../lib/slackOAuth"

const SECRET = "test-signing-secret-material"
const OWNER = { role: "owner" as const, wallet: { id: "wallet_1" }, actor: { type: "user" as const } }
const VIEWER = { role: "viewer" as const, wallet: { id: "wallet_1" }, actor: { type: "user" as const } }

function startReq() {
  return new NextRequest("https://getsanction.com/api/slack/oauth/start")
}

function callbackReq(params: Record<string, string>) {
  const url = new URL("https://getsanction.com/api/slack/oauth/callback")
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SANCTION_SIGNING_SECRET", SECRET)
  vi.stubEnv("SANCTION_SLACK_CLIENT_ID", "client.123")
  vi.stubEnv("SANCTION_SLACK_CLIENT_SECRET", "client.secret")
  rateLimitMock.mockResolvedValue({ ok: true, limit: 20 })
  sessionMock.getSessionMember.mockResolvedValue(OWNER)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("GET /api/slack/oauth/start", () => {
  it("fails closed when the Slack client id is unset", async () => {
    vi.stubEnv("SANCTION_SLACK_CLIENT_ID", "")
    const res = await slackOAuthStart(startReq())
    expect(res.status).toBe(503)
  })

  it("sends an anonymous visitor to login", async () => {
    sessionMock.getSessionMember.mockResolvedValue(null)
    const res = await slackOAuthStart(startReq())
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login?next=")
  })

  it("refuses a viewer", async () => {
    sessionMock.getSessionMember.mockResolvedValue(VIEWER)
    const res = await slackOAuthStart(startReq())
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("slack=forbidden")
  })

  it("429s when the per-IP limiter trips", async () => {
    rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 9, limit: 20 })
    const res = await slackOAuthStart(startReq())
    expect(res.status).toBe(429)
  })

  it("redirects an admin to Slack with a wallet-bound state", async () => {
    const res = await slackOAuthStart(startReq())
    expect(res.status).toBe(307)
    const loc = new URL(res.headers.get("location")!)
    expect(loc.origin + loc.pathname).toBe("https://slack.com/oauth/v2/authorize")
    expect(loc.searchParams.get("scope")).toBe("chat:write,incoming-webhook")
    const state = loc.searchParams.get("state")!
    const { verifySlackOAuthState } = await import("../lib/slackOAuth")
    expect(await verifySlackOAuthState(state)).toEqual({ walletId: "wallet_1" })
  })
})

describe("GET /api/slack/oauth/callback", () => {
  const realFetch = global.fetch

  afterEach(() => {
    global.fetch = realFetch
  })

  it("maps Slack access_denied to the approvals page", async () => {
    const res = await slackOAuthCallback(callbackReq({ error: "access_denied" }))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("slack=denied")
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it("rejects a state bound to a different wallet", async () => {
    const state = await issueSlackOAuthState("wallet_other")
    const res = await slackOAuthCallback(callbackReq({ state, code: "x" }))
    expect(res.headers.get("location")).toContain("slack=invalid")
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it("fails closed when Slack omits the incoming-webhook channel", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          access_token: "xoxb-install",
          team: { id: "T123" },
        }),
      ),
    ) as never
    const state = await issueSlackOAuthState("wallet_1")
    const res = await slackOAuthCallback(callbackReq({ state, code: "x" }))
    expect(res.headers.get("location")).toContain("slack=failed")
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it("stores the encrypted bot token and pings the channel", async () => {
    global.fetch = vi.fn(async (url: string | URL) => {
      const href = String(url)
      if (href.includes("oauth.v2.access")) {
        return new Response(
          JSON.stringify({
            ok: true,
            access_token: "xoxb-install",
            team: { id: "T123", name: "Acme" },
            incoming_webhook: { channel_id: "C0123456789", channel: "#approvals" },
            authed_user: { id: "U1" },
          }),
        )
      }
      return new Response(JSON.stringify({ ok: true }))
    }) as never
    const state = await issueSlackOAuthState("wallet_1")
    const res = await slackOAuthCallback(callbackReq({ state, code: "oauth-code" }))
    expect(res.headers.get("location")).toContain("slack=connected")
    expect(encryptMock).toHaveBeenCalledWith("xoxb-install", "wallet_1", "slack:bot:T123")
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ channelId: "C0123456789", botTokenEnc: "enc-blob" }),
      }),
    )
    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit]>
    const chat = calls.find(([u]) => String(u).includes("chat.postMessage"))
    expect(chat).toBeTruthy()
    expect(new Headers(chat![1].headers).get("authorization")).toBe("Bearer xoxb-install")
  })
})
