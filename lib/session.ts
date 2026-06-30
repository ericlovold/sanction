import { cookies, headers } from "next/headers"
import { db } from "./db"
import { hashApiKey, generateApiKey } from "./apiKey"
import { auth } from "./auth-config"

// Two ways to be signed in, bridged here so the rest of the app never cares:
//   1. Better Auth session (Google/GitHub) → a User → the Wallet it owns.
//   2. Legacy: an httpOnly cookie holding the wallet's sk_ management key.
// Both resolve to the same Prisma Wallet. New social users get a wallet
// provisioned on first sign-in; existing wallets are claimed by matching email.
export const SESSION_COOKIE = "sanction_session"
const MAX_AGE = 60 * 60 * 24 * 30

export async function setSession(managementKey: string) {
  ;(await cookies()).set(SESSION_COOKIE, managementKey, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  })
}

export async function clearSession() {
  ;(await cookies()).delete(SESSION_COOKIE)
  // Also end any Better Auth session (nextCookies clears its cookie here).
  try {
    await auth.api.signOut({ headers: await headers() })
  } catch {
    // No social session to end — legacy logout only.
  }
}

// Map a signed-in human to the wallet they control. Claim-by-email links a
// pre-existing wallet (legacy/magic-link customer now using social login) to the
// User exactly once; otherwise provision a fresh wallet like /start does.
async function resolveWalletForUser(user: { id: string; email: string; name?: string | null }) {
  const linked = await db.wallet.findFirst({ where: { userId: user.id } })
  if (linked) return linked

  const byEmail = await db.wallet.findUnique({ where: { ownerEmail: user.email } })
  if (byEmail) {
    return db.wallet.update({ where: { id: byEmail.id }, data: { userId: user.id } })
  }

  try {
    const wallet = await db.wallet.create({
      data: {
        name: user.name?.trim() || `${user.email.split("@")[0]}'s workspace`,
        ownerEmail: user.email,
        userId: user.id,
        policy: { create: {} },
      },
    })
    const key = generateApiKey()
    await db.agent.create({
      data: { walletId: wallet.id, name: "default-agent", apiKeyHash: key.hash, apiKeyPrefix: key.prefix },
    })
    return wallet
  } catch {
    // Race: a concurrent render won the unique ownerEmail. Re-read its result.
    return db.wallet.findUnique({ where: { ownerEmail: user.email } })
  }
}

export async function getSessionWallet() {
  // Social session first. Guarded so a not-yet-configured Better Auth (missing
  // env on a fresh deploy) can never break the legacy key / magic-link login.
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (session?.user) return resolveWalletForUser(session.user)
  } catch {
    // fall through to the management-key path
  }

  const raw = (await cookies()).get(SESSION_COOKIE)?.value
  if (raw) return db.wallet.findUnique({ where: { mgmtKeyHash: hashApiKey(raw) } })
  return null
}

/**
 * The wallet a dashboard page should render: the logged-in wallet if there's a
 * session, otherwise the public demo wallet (SANCTION_WALLET_ID) in read-only
 * mode. Returns null only if neither exists.
 */
export async function getViewWallet() {
  const s = await getSessionWallet()
  if (s) return { id: s.id, name: s.name, isSession: true as const }

  const demo = process.env.SANCTION_WALLET_ID
  if (demo) {
    const w = await db.wallet.findUnique({ where: { id: demo } })
    if (w) return { id: w.id, name: w.name, isSession: false as const }
  }
  return null
}
