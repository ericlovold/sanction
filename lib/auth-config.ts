import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { nextCookies } from "better-auth/next-js"
import { db } from "@/lib/db"

// Better Auth = the human identity layer for the console (Google, GitHub,
// Apple). It owns the User/Session/Account/Verification tables in our Neon
// DB — this is the "permanent user database." It does NOT touch the agent/mgmt
// API auth (x-api-key / x-mgmt-key); those stay key-based. The wallet a signed-in
// user controls is resolved in lib/session.ts (claims a wallet by email on first
// login, else provisions one).
//
// Account linking is on by default: signing in with Google then GitHub on the
// same verified email lands on one User. Magic-link + sk_ login still work
// unchanged for existing wallets (legacy path in lib/session.ts).
//
// Apple is env-gated: the provider (and its button) only exists when
// APPLE_CLIENT_ID is set, so deploys without the Apple credentials keep
// working. APPLE_CLIENT_ID is the Services ID; APPLE_CLIENT_SECRET is the
// ES256 JWT minted by scripts/apple-client-secret.mjs (max 6-month life —
// re-mint and rotate the Vercel env before it expires).
const appleEnabled = !!process.env.APPLE_CLIENT_ID

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(db, { provider: "postgresql" }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
    ...(appleEnabled
      ? {
          apple: {
            clientId: process.env.APPLE_CLIENT_ID as string,
            clientSecret: process.env.APPLE_CLIENT_SECRET as string,
          },
        }
      : {}),
  },
  // Apple's OAuth response arrives as a cross-origin form_post from
  // appleid.apple.com — it must be a trusted origin or the callback is rejected.
  ...(appleEnabled ? { trustedOrigins: ["https://appleid.apple.com"] } : {}),
  // nextCookies must be last — it flushes Set-Cookie from server actions.
  plugins: [nextCookies()],
})
