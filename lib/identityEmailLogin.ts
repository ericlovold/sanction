import { createHash } from "crypto"
import { SignJWT, jwtVerify } from "jose"
import { magicLink } from "better-auth/plugins"
import { sendIdentitySignInEmail } from "./email"

export const IDENTITY_EMAIL_TTL_SECONDS = 900
const PURPOSE = "sanction-identity-email-login"

function signingKey() {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error("Identity email sign-in is not configured")
  return new TextEncoder().encode(secret)
}

export function identityEmailCallback(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 20_000 || /[\\\x00-\x20]|%5c|%0[ad9]/i.test(raw)) throw new Error("Invalid sign-in destination")
  const url = new URL(raw, "https://sanction.invalid")
  if (!raw.startsWith("/") || raw.startsWith("//") || url.origin !== "https://sanction.invalid" || url.hash ||
      !["/dashboard", "/connect/mcp", "/api/auth/oauth2/authorize"].includes(url.pathname)) throw new Error("Invalid sign-in destination")
  return `${url.pathname}${url.search}`
}

export function identityEmailRateKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex")
}

export async function issueIdentityEmailEnvelope(token: string, email: string, callback: string): Promise<string> {
  return new SignJWT({ token, email: email.trim().toLowerCase(), callback: identityEmailCallback(callback) })
    .setProtectedHeader({ alg: "HS256" }).setIssuer(PURPOSE).setAudience(PURPOSE)
    .setIssuedAt().setExpirationTime(`${IDENTITY_EMAIL_TTL_SECONDS}s`).sign(signingKey())
}

export async function readIdentityEmailEnvelope(envelope: string): Promise<{ token: string; email: string; callback: string }> {
  if (envelope.length > 40_000) throw new Error("Invalid sign-in link")
  const { payload } = await jwtVerify(envelope, signingKey(), { algorithms: ["HS256"], issuer: PURPOSE, audience: PURPOSE })
  if (typeof payload.token !== "string" || !payload.token || typeof payload.email !== "string" || !payload.email) throw new Error("Invalid sign-in link")
  return { token: payload.token, email: payload.email, callback: identityEmailCallback(payload.callback) }
}

export function identityEmailPlugin() {
  return magicLink({
    disableSignUp: true,
    storeToken: "hashed",
    expiresIn: IDENTITY_EMAIL_TTL_SECONDS,
    async sendMagicLink({ email, token, url }) {
      const configured = process.env.BETTER_AUTH_URL
      if (!configured) throw new Error("Identity email sign-in is not configured")
      const origin = new URL(configured)
      if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) throw new Error("Invalid sign-in origin")
      const callback = identityEmailCallback(new URL(url).searchParams.get("callbackURL") ?? "/dashboard")
      const envelope = await issueIdentityEmailEnvelope(token, email, callback)
      const confirmation = new URL("/connect/mcp/login/verify", origin.origin)
      confirmation.searchParams.set("token", envelope)
      await sendIdentitySignInEmail(email, confirmation.toString())
    },
  })
}
