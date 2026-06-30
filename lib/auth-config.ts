import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { nextCookies } from "better-auth/next-js"
import { db } from "@/lib/db"

// Better Auth = the human identity layer for the console (Google + GitHub now,
// Apple later). It owns the User/Session/Account/Verification tables in our Neon
// DB — this is the "permanent user database." It does NOT touch the agent/mgmt
// API auth (x-api-key / x-mgmt-key); those stay key-based. The wallet a signed-in
// user controls is resolved in lib/session.ts (claims a wallet by email on first
// login, else provisions one).
//
// Account linking is on by default: signing in with Google then GitHub on the
// same verified email lands on one User. Magic-link + sk_ login still work
// unchanged for existing wallets (legacy path in lib/session.ts).
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
  },
  // nextCookies must be last — it flushes Set-Cookie from server actions.
  plugins: [nextCookies()],
})
