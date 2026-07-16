import { cookies, headers } from "next/headers"
import { db } from "./db"
import { hashApiKey, generateApiKey } from "./apiKey"
import { auth } from "./auth-config"
import { hasRole, type WalletRole } from "./roles"

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
//
// Precedence: owning a wallet outright always wins. This means someone who
// already owns their own wallet and is ALSO an accepted WalletMember of a
// different one will only ever land on the one they own here — there's no
// wallet switcher yet (WALLET-MEMBERS follow-up). The invite-accept flow
// (app/invite/[token]/actions.ts) refuses to activate a membership for
// someone who already owns a different wallet, specifically so this
// precedence rule can never produce an unreachable "active" membership.
async function resolveWalletForUser(user: { id: string; email: string; name?: string | null }) {
  const linked = await db.wallet.findFirst({ where: { userId: user.id } })
  if (linked) return linked

  const byEmail = await db.wallet.findUnique({ where: { ownerEmail: user.email } })
  if (byEmail) {
    return db.wallet.update({ where: { id: byEmail.id }, data: { userId: user.id } })
  }

  const membership = await db.walletMember.findFirst({ where: { userId: user.id, status: "active" } })
  if (membership) return db.wallet.findUnique({ where: { id: membership.walletId } })

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

export type SessionActor = { type: "key" } | { type: "user"; userId: string; email: string; name: string | null }

/**
 * Like getSessionWallet, but also resolves WHO is acting and at what role —
 * the legacy sk_ session and the wallet's own creator are always "owner" (no
 * WalletMember row needed, see resolveWalletForUser's precedence note);
 * anyone else is whatever role their active WalletMember row carries.
 * Mutating dashboard actions should call this instead of getSessionWallet so
 * they can enforce a role floor (lib/roles.ts's hasRole).
 */
export async function getSessionMember(): Promise<
  { wallet: NonNullable<Awaited<ReturnType<typeof getSessionWallet>>>; role: WalletRole; actor: SessionActor } | null
> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (session?.user) {
      const wallet = await resolveWalletForUser(session.user)
      if (!wallet) return null
      const actor: SessionActor = {
        type: "user",
        userId: session.user.id,
        email: session.user.email,
        name: session.user.name ?? null,
      }
      if (wallet.userId === session.user.id) return { wallet, role: "owner", actor }

      const membership = await db.walletMember.findFirst({
        where: { walletId: wallet.id, userId: session.user.id, status: "active" },
      })
      // resolveWalletForUser only ever returns this wallet via ownership or an
      // active membership, so a miss here would mean a race (e.g. revoked
      // between the two reads) — fail closed rather than default to a role.
      if (!membership) return null
      return { wallet, role: membership.role as WalletRole, actor }
    }
  } catch {
    // fall through to the management-key path
  }

  const raw = (await cookies()).get(SESSION_COOKIE)?.value
  if (raw) {
    const wallet = await db.wallet.findUnique({ where: { mgmtKeyHash: hashApiKey(raw) } })
    if (wallet) return { wallet, role: "owner", actor: { type: "key" } }
  }
  return null
}

/**
 * Like getSessionWallet, but enforces a role floor (WALLET-MEMBERS follow-up,
 * part 1): returns null — the same denial a mutating action already gives an
 * anonymous visitor — when the signed-in member's role doesn't meet `min`, so
 * every "if (!wallet) return ..." early-return in the dashboard actions keeps
 * working unchanged. A `viewer` member gets the same no-op/"log in" response
 * as someone not signed in at all; they never reach the write.
 */
export async function requireSessionRole(min: WalletRole) {
  const member = await getSessionMember()
  if (!member || !hasRole(member.role, min)) return null
  return member.wallet
}

/**
 * The wallet a dashboard page should render: the logged-in wallet if there's a
 * session, otherwise the public demo wallet (SANCTION_WALLET_ID) in read-only
 * mode. Returns null only if neither exists.
 */
export async function getViewWallet() {
  const s = await getSessionMember()
  if (s) return { id: s.wallet.id, name: s.wallet.name, isSession: true as const, role: s.role }

  const demo = process.env.SANCTION_WALLET_ID
  if (demo) {
    const w = await db.wallet.findUnique({ where: { id: demo } })
    if (w) return { id: w.id, name: w.name, isSession: false as const, role: "viewer" as const }
  }
  return null
}
