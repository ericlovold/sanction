import { createHash, randomBytes, randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const { sendIdentitySignInEmail } = vi.hoisted(() => ({ sendIdentitySignInEmail: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendIdentitySignInEmail }))

// Exercise the real Better Auth adapter/plugin against PostgreSQL. Only email
// delivery is replaced; no network, social provider or fabricated session.
describe.skipIf(process.env.RUN_DB_TESTS !== "1")("verified identity email login", () => {
  const origin = "http://localhost:3119"
  const userId = `email-login-${randomUUID()}`
  const email = `${userId}@example.test`
  const unknownEmail = `unknown-${userId}@example.test`
  let auth: typeof import("../lib/auth-config")["auth"]
  let db: typeof import("../lib/db")["db"]
  let readEnvelope: typeof import("../lib/identityEmailLogin")["readIdentityEmailEnvelope"]
  let clientId: string | undefined

  async function issue(target = email, callbackURL = "/dashboard") {
    sendIdentitySignInEmail.mockClear()
    await auth.api.signInMagicLink({ headers: new Headers({ origin }), body: { email: target, callbackURL } })
    expect(sendIdentitySignInEmail).toHaveBeenCalledOnce()
    const [recipient, link] = sendIdentitySignInEmail.mock.calls[0] as [string, string]
    expect(recipient).toBe(target)
    const url = new URL(link)
    expect(url.origin).toBe(origin)
    expect(url.pathname).toBe("/connect/mcp/login/verify")
    const envelope = await readEnvelope(url.searchParams.get("token")!)
    expect(envelope.email).toBe(target)
    expect(envelope.callback).toBe(callbackURL)
    return { ...envelope, identifier: `magic-link:${createHash("sha256").update(envelope.token).digest("base64url")}` }
  }

  function verify(token: string) {
    return auth.api.magicLinkVerify({ headers: new Headers({ origin }), query: { token }, asResponse: true })
  }

  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Identity login DB tests must not use external HTTP") }))
    vi.stubEnv("SANCTION_MCP_OAUTH_ENABLED", "true")
    vi.stubEnv("BETTER_AUTH_URL", origin)
    vi.stubEnv("BETTER_AUTH_SECRET", "local-email-test-secret-not-for-production-2026")
    ;({ db } = await import("../lib/db"))
    ;({ auth } = await import("../lib/auth-config"))
    ;({ readIdentityEmailEnvelope: readEnvelope } = await import("../lib/identityEmailLogin"))
    await auth.$context
    await db.user.create({ data: { id: userId, email, name: "Isolated email login fixture", emailVerified: false } })
  }, 30_000)

  afterAll(async () => {
    if (db) {
      if (clientId) await db.oauthClient.deleteMany({ where: { clientId } })
      await db.verification.deleteMany({ where: { value: { contains: userId } } })
      await db.user.deleteMany({ where: { id: userId } })
    }
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("blocks public plugin endpoints without sending mail or consuming a link", async () => {
    const issued = await issue()
    const requested = await auth.handler(new Request(`${origin}/api/auth/sign-in/magic-link`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email }),
    }))
    expect(requested.status).toBe(404)
    expect(sendIdentitySignInEmail).toHaveBeenCalledOnce()
    const clicked = await auth.handler(new Request(`${origin}/api/auth/magic-link/verify?token=${issued.token}`))
    expect(clicked.status).toBe(404)
    expect(await db.verification.count({ where: { identifier: issued.identifier } })).toBe(1)
    expect(await db.session.count({ where: { userId } })).toBe(0)
  })

  it("stores only a hashed token and verifies the existing identity with a real session cookie", async () => {
    const issued = await issue()
    const stored = await db.verification.findFirst({ where: { identifier: issued.identifier } })
    expect(stored).not.toBeNull()
    expect(JSON.stringify(stored)).not.toContain(issued.token)
    expect(stored!.expiresAt.getTime() - Date.now()).toBeGreaterThan(850_000)
    expect(stored!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(900_000)
    const response = await verify(issued.token)
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.user).toMatchObject({ id: userId, email, emailVerified: true })
    const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ")
    expect(cookie).toContain("session_token=")
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) })
    expect(session?.user).toMatchObject({ id: userId, emailVerified: true })
    expect(await db.verification.count({ where: { identifier: issued.identifier } })).toBe(0)
    const replay = await verify(issued.token)
    expect(replay.status).toBe(302)
    expect(replay.headers.get("location")).toContain("INVALID_TOKEN")
    expect(replay.headers.get("set-cookie")).toBeNull()
    // Server actions use the default API mode and catch its redirect error.
    await expect(auth.api.magicLinkVerify({ headers: new Headers({ origin }), query: { token: issued.token } }))
      .rejects.toMatchObject({ status: "FOUND" })
  })

  it("allows only one verification winner when the same link is submitted concurrently", async () => {
    const issued = await issue()
    const before = await db.session.count({ where: { userId } })
    const results = await Promise.all(Array.from({ length: 6 }, () => verify(issued.token)))
    expect(results.filter(result => result.status === 200)).toHaveLength(1)
    for (const result of results.filter(result => result.status !== 200)) {
      expect(result.status).toBe(302)
      expect(result.headers.get("location")).toContain("INVALID_TOKEN")
      expect(result.headers.get("set-cookie")).toBeNull()
    }
    expect(await db.session.count({ where: { userId } })).toBe(before + 1)
  })

  it("rejects an expired database token without creating a session", async () => {
    const issued = await issue()
    await db.verification.updateMany({ where: { identifier: issued.identifier }, data: { expiresAt: new Date(Date.now() - 60_000) } })
    const before = await db.session.count({ where: { userId } })
    const response = await verify(issued.token)
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toContain("INVALID_TOKEN")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(await db.session.count({ where: { userId } })).toBe(before)
  })

  it("does not provision an unknown identity through the plugin", async () => {
    const issued = await issue(unknownEmail)
    const response = await verify(issued.token)
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toContain("new_user_signup_disabled")
    expect(await db.user.count({ where: { email: unknownEmail } })).toBe(0)
  })

  it("resumes an OAuth authorization using the email-verified session", async () => {
    const redirectUri = "http://127.0.0.1:48124/callback"
    const registration = await auth.handler(new Request(`${origin}/api/auth/oauth2/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: userId, redirect_uris: [redirectUri], application_type: "native", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
    }))
    expect(registration.status).toBe(201)
    clientId = (await registration.json()).client_id
    const query = new URLSearchParams({ response_type: "code", client_id: clientId!, redirect_uri: redirectUri,
      scope: "sanction:approvals offline_access", resource: `${origin}/mcp/approvals`, state: randomUUID(),
      code_challenge: createHash("sha256").update(randomBytes(32)).digest("base64url"), code_challenge_method: "S256" })
    const callback = `/api/auth/oauth2/authorize?${query}`
    const issued = await issue(email, callback)
    const verified = await verify(issued.token)
    expect(verified.status).toBe(200)
    const cookie = verified.headers.getSetCookie().map(value => value.split(";")[0]).join("; ")
    const resumed = await auth.handler(new Request(`${origin}${issued.callback}`, { headers: { cookie } }))
    expect(resumed.status).toBe(302)
    const destination = new URL(resumed.headers.get("location")!, origin)
    expect(destination.pathname).toBe("/connect/mcp")
    expect(destination.searchParams.get("client_id")).toBe(clientId)
    expect(destination.searchParams.has("sig")).toBe(true)
  })
})
