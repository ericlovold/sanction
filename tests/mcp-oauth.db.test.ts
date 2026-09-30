import { randomBytes, randomUUID, createHash } from "node:crypto"
import { serializeSignedCookie } from "better-call"
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// Real provider, adapter and signing keys; only the session is a synthetic
// database fixture. No social provider, HTTP server or remote JWKS is needed.
describe.skipIf(process.env.RUN_DB_TESTS !== "1")("MCP OAuth provider integration", () => {
  const origin = "http://localhost:3118"
  const resource = `${origin}/mcp/approvals`
  const redirectUri = "http://127.0.0.1:48123/callback"
  const secret = "local-oauth-test-secret-not-for-production-2026"
  const userId = `oauth-test-${randomUUID()}`
  let auth: typeof import("../lib/auth-config")["auth"]
  let db: typeof import("../lib/db")["db"]
  let context: typeof import("../lib/mcpOAuthContext")["mcpOAuthConsentContext"]
  let cookie: string
  let walletId: string
  let agentIds: string[]
  let clientId: string

  async function post(path: string, body: Record<string, string>, authenticated = false) {
    return auth.handler(new Request(`${origin}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...(authenticated ? { cookie, origin } : {}) },
      body: new URLSearchParams(body),
    }))
  }

  async function authorization() {
    const verifier = randomBytes(32).toString("base64url")
    const query = new URLSearchParams({
      response_type: "code", client_id: clientId, redirect_uri: redirectUri,
      scope: "sanction:approvals offline_access", resource, state: randomUUID(),
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    })
    const response = await auth.handler(new Request(`${origin}/api/auth/oauth2/authorize?${query}`, { headers: { cookie } }))
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get("location")!, origin)
    expect(location.pathname).toBe("/connect/mcp")
    expect(location.searchParams.has("sig")).toBe(true)
    return { verifier, oauthQuery: location.searchParams.toString() }
  }

  async function consent(agentId = agentIds[0]) {
    const flow = await authorization()
    const connection = await db.mcpOAuthConnection.create({ data: { userId, walletId, agentId, clientId } })
    const result = await context.run({ connectionId: connection.id, userId }, () => auth.api.oauth2Consent({
      asResponse: false,
      request: new Request(`${origin}/api/auth/oauth2/consent`, { method: "POST", headers: { cookie, origin } }),
      headers: new Headers({ cookie, origin }), body: { accept: true, oauth_query: flow.oauthQuery },
    }))
    const url = new URL(result.url)
    expect(`${url.origin}${url.pathname}`).toBe(redirectUri)
    expect(url.searchParams.get("code")).toBeTruthy()
    return { ...flow, connection, code: url.searchParams.get("code")! }
  }

  async function exchange(code: string, verifier: string) {
    return post("/oauth2/token", { grant_type: "authorization_code", client_id: clientId, redirect_uri: redirectUri, code, code_verifier: verifier, resource })
  }

  async function verify(token: string) {
    const response = await auth.handler(new Request(`${origin}/api/auth/jwks`))
    expect(response.status).toBe(200)
    const keys = await response.json()
    expect(decodeProtectedHeader(token).typ).toBe("at+jwt")
    return jwtVerify(token, createLocalJWKSet(keys), { issuer: `${origin}/api/auth`, audience: resource })
  }

  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("OAuth DB tests must not use external HTTP") }))
    vi.stubEnv("SANCTION_MCP_OAUTH_ENABLED", "true")
    vi.stubEnv("BETTER_AUTH_URL", origin)
    vi.stubEnv("BETTER_AUTH_SECRET", secret)
    ;({ db } = await import("../lib/db"))
    ;({ auth } = await import("../lib/auth-config"))
    ;({ mcpOAuthConsentContext: context } = await import("../lib/mcpOAuthContext"))
    await auth.$context
    await db.user.create({ data: { id: userId, name: "OAuth integration fixture", email: `${userId}@example.test`, emailVerified: true } })
    const wallet = await db.wallet.create({ data: { name: "OAuth test", ownerEmail: `${userId}@example.test`, userId } })
    walletId = wallet.id
    agentIds = []
    for (let index = 0; index < 2; index++) {
      const agent = await db.agent.create({ data: { walletId, name: `oauth-agent-${index}`, apiKeyHash: randomBytes(32).toString("hex"), apiKeyPrefix: "pxy_test" } })
      agentIds.push(agent.id)
    }
    const sessionToken = randomBytes(32).toString("hex")
    await db.session.create({ data: { id: randomUUID(), userId, token: sessionToken, expiresAt: new Date(Date.now() + 3_600_000) } })
    // Same signer Better Auth uses in setSessionCookie, with its runtime cookie
    // name (secure prefix varies by origin). No forged/mocked auth middleware.
    const authContext = await auth.$context
    cookie = (await serializeSignedCookie(authContext.authCookies.sessionToken.name, sessionToken, secret, { path: "/" })).split(";")[0]
    expect((await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user.id).toBe(userId)
    const response = await auth.handler(new Request(`${origin}/api/auth/oauth2/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: `Integration ${userId}`, redirect_uris: [redirectUri], token_endpoint_auth_method: "none", application_type: "native", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
    }))
    const client = await response.json()
    expect(response.status, JSON.stringify(client)).toBe(201)
    clientId = client.client_id
    expect(clientId).toBeTruthy()
  }, 30_000)

  afterAll(async () => {
    if (db) {
      if (clientId) await db.oauthClient.deleteMany({ where: { clientId } })
      await db.verification.deleteMany({ where: { value: { contains: userId } } })
      if (walletId) {
        await db.agent.deleteMany({ where: { walletId } })
        await db.wallet.deleteMany({ where: { id: walletId } })
      }
      await db.user.deleteMany({ where: { id: userId } })
    }
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("publishes bound metadata and refuses generic session JWT issuance", async () => {
    const metadata = await auth.handler(new Request(`${origin}/.well-known/oauth-protected-resource/mcp/approvals`))
    expect(metadata.status).toBe(200)
    expect(await metadata.json()).toMatchObject({ resource, authorization_servers: [`${origin}/api/auth`], scopes_supported: ["sanction:approvals"] })
    const token = await auth.handler(new Request(`${origin}/api/auth/token`, { headers: { cookie } }))
    expect(token.status).toBe(404)
  })

  it("rejects direct consent and a mismatched request-local human", async () => {
    const flow = await authorization()
    const response = await auth.handler(new Request(`${origin}/api/auth/oauth2/consent`, {
      method: "POST", headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify({ accept: true, oauth_query: flow.oauthQuery }),
    }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ message: "Select an agent through the MCP consent page" })
    await expect(context.run({ connectionId: "untrusted", userId: "other-user" }, () => auth.api.oauth2Consent({
      asResponse: false,
      request: new Request(`${origin}/api/auth/oauth2/consent`, { method: "POST", headers: { cookie, origin } }),
      headers: new Headers({ cookie, origin }), body: { accept: true, oauth_query: flow.oauthQuery },
    }))).rejects.toMatchObject({ status: "FORBIDDEN" })
  })

  it("exchanges S256 codes for audience-bound JWTs and rejects code replay", async () => {
    const flow = await consent()
    const response = await exchange(flow.code, flow.verifier)
    const tokens = await response.json()
    expect(response.status, JSON.stringify(tokens)).toBe(200)
    const { payload } = await verify(tokens.access_token)
    expect(payload).toMatchObject({ sub: userId, aud: resource, sanction_connection_id: flow.connection.id })
    expect(tokens.refresh_token).toBeTruthy()
    const keys = await (await auth.handler(new Request(`${origin}/api/auth/jwks`))).json()
    await expect(jwtVerify(tokens.access_token, createLocalJWKSet(keys), { issuer: `${origin}/api/auth`, audience: `${origin}/mcp` })).rejects.toThrow()
    expect(typeof payload.exp).toBe("number")
    await expect(jwtVerify(tokens.access_token, createLocalJWKSet(keys), {
      issuer: `${origin}/api/auth`, audience: resource, currentDate: new Date((payload.exp! + 1) * 1000),
    })).rejects.toMatchObject({ code: "ERR_JWT_EXPIRED" })
    const parts = tokens.access_token.split(".")
    const signature = Buffer.from(parts[2], "base64url")
    signature[0] ^= 1
    parts[2] = signature.toString("base64url")
    await expect(jwtVerify(parts.join("."), createLocalJWKSet(keys), {
      issuer: `${origin}/api/auth`, audience: resource,
    })).rejects.toMatchObject({ code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" })
    expect((await exchange(flow.code, flow.verifier)).status).toBeGreaterThanOrEqual(400)
  })

  it.each([
    ["consent bypass", { skip_consent: true }],
    ["client credentials grant", { grant_types: ["client_credentials"] }],
    ["unapproved scope", { scope: "sanction:approvals sanction:credentials" }],
  ])("refuses DCR %s", async (_label, overrides) => {
    const name = `Rejected ${userId} ${_label}`
    const response = await auth.handler(new Request(`${origin}/api/auth/oauth2/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: name, redirect_uris: [redirectUri], application_type: "native",
        token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"], ...overrides }),
    }))
    expect(response.status).toBe(400)
    expect((await response.json()).client_id).toBeUndefined()
    expect(await db.oauthClient.count({ where: { name } })).toBe(0)
  })

  it("rejects a wrong PKCE verifier", async () => {
    const flow = await consent()
    const response = await exchange(flow.code, randomBytes(32).toString("base64url"))
    expect(response.status).toBe(401)
    expect((await response.json()).error).toBeTruthy()
  })

  it("pins refresh to its original selection and refuses revoked connections", async () => {
    const first = await consent(agentIds[0])
    const firstTokens = await (await exchange(first.code, first.verifier)).json()
    const second = await consent(agentIds[1])
    const secondTokens = await (await exchange(second.code, second.verifier)).json()
    expect((await verify(firstTokens.access_token)).payload.sanction_connection_id).toBe(first.connection.id)
    expect((await verify(secondTokens.access_token)).payload.sanction_connection_id).toBe(second.connection.id)
    const refreshed = await post("/oauth2/token", { grant_type: "refresh_token", client_id: clientId, refresh_token: firstTokens.refresh_token, resource })
    const refreshedTokens = await refreshed.json()
    expect(refreshed.status, JSON.stringify(refreshedTokens)).toBe(200)
    expect((await verify(refreshedTokens.access_token)).payload.sanction_connection_id).toBe(first.connection.id)
    expect((await db.mcpOAuthConnection.findFirst({ where: { id: first.connection.id, walletId } }))?.agentId).toBe(agentIds[0])
    await db.mcpOAuthConnection.updateMany({ where: { id: first.connection.id, walletId }, data: { revokedAt: new Date() } })
    const rejected = await post("/oauth2/token", { grant_type: "refresh_token", client_id: clientId, refresh_token: refreshedTokens.refresh_token, resource })
    expect(rejected.status).toBeGreaterThanOrEqual(400)
    expect((await rejected.json()).access_token).toBeUndefined()
  })

  it("supports provider refresh-token revocation", async () => {
    const flow = await consent()
    const tokens = await (await exchange(flow.code, flow.verifier)).json()
    const revoked = await post("/oauth2/revoke", { client_id: clientId, token: tokens.refresh_token, token_type_hint: "refresh_token" })
    expect(revoked.status).toBe(200)
    const response = await post("/oauth2/token", { grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token, resource })
    expect(response.status).toBe(400)
  })
})
