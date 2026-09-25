import { cookies, headers } from "next/headers"
import { db } from "./db"
import { hashApiKey, generateApiKey } from "./apiKey"
import { auth } from "./auth-config"
import { hasRole, type WalletRole } from "./roles"
import { logger } from "./log"
import { scopeTenant, withTenant } from "./rls"
import type { Prisma } from "./generated/prisma/client"

const log = logger("session")

// Two ways to be signed in, bridged here so the rest of the app never cares:
//   1. Better Auth session (Google/GitHub) → a User → the Wallet it owns.
//   2. Legacy: an httpOnly cookie holding the wallet's sk_ management key.
// Both resolve to the same Prisma Wallet. New social users get a wallet
// provisioned on first sign-in; existing wallets are claimed by matching
// verified email.
export const SESSION_COOKIE = "sanction_session"
// Which of the session's reachable wallets to act as (WALLET-MEMBERS part 2,
// the wallet switcher). Holds a walletId — non-secret by convention — and only
// ever SELECTS among wallets the session can already reach: every resolve
// re-validates ownership-or-active-membership, so a stale or forged value
// falls back to the default precedence instead of granting anything.
export const ACTIVE_WALLET_COOKIE = "sanction_active_wallet"
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

export async function setActiveWallet(walletId: string) {
  ;(await cookies()).set(ACTIVE_WALLET_COOKIE, walletId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  })
}

export async function clearSession() {
  ;(await cookies()).delete(ACTIVE_WALLET_COOKIE)
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
// User exactly once — verified emails only, rotating pre-claim keys; otherwise
// provision a fresh wallet like /start does.
//
// Precedence: an explicitly selected wallet (the switcher cookie, validated
// against ownership-or-active-membership on every resolve) wins; otherwise
// owning a wallet outright wins over memberships. Someone who owns their own
// wallet AND holds memberships reaches the others through the switcher
// (WALLET-MEMBERS part 2).
async function resolveWalletForUser(
  user: { id: string; email: string; emailVerified?: boolean | null; name?: string | null },
  preferredWalletId?: string | null,
) {
  if (preferredWalletId) {
    const preferred = await db.wallet.findUnique({ where: { id: preferredWalletId } })
    if (preferred) {
      if (preferred.userId === user.id) return preferred
      const membership = await db.walletMember.findFirst({
        where: { walletId: preferred.id, userId: user.id, status: "active" },
      })
      if (membership) return preferred
    }
    // Stale or foreign selection — ignore it and fall through to the default
    // precedence rather than erroring the whole session.
  }

  const linked = await db.wallet.findFirst({ where: { userId: user.id } })
  if (linked) return linked

  // ownerEmail is unverified at creation (POST /wallets, /start), so a wallet
  // matching this email may be a squat whose sk_ someone else holds. Claim only
  // on a provider-verified email, and rotate out everything minted before the
  // claim (claimWallet). An unverified user never lands in it.
  const byEmail = await db.wallet.findUnique({ where: { ownerEmail: user.email } })
  if (byEmail && !byEmail.userId && user.emailVerified === true) {
    const claimed = await claimWallet(byEmail.id, user.id)
    if (claimed) return claimed
  }

  const membership = await db.walletMember.findFirst({ where: { userId: user.id, status: "active" } })
  if (membership) return db.wallet.findUnique({ where: { id: membership.walletId } })

  // The ownerEmail is taken — provisioning would collide, and the existing
  // wallet isn't ours to hand back.
  if (byEmail) return null

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
    // Race: a concurrent render won the unique ownerEmail. Re-read its result,
    // but only if that render provisioned it for this user.
    const raced = await db.wallet.findUnique({ where: { ownerEmail: user.email } })
    return raced?.userId === user.id ? raced : null
  }
}

// Link a wallet to its verified owner and revoke every credential and control
// channel issued before the claim, in one transaction: the sk_ key is cleared
// (re-mint from the dashboard), agent keys are replaced with unmatchable hashes
// and deactivated (a reactivation can't revive a key someone else holds), live
// execution JWTs are revoked, memberships the key holder handed out are
// revoked, Slack installs are revoked (a squatter's install could otherwise
// approve escalations and mint grants), and webhooks are deactivated. Returns
// null if another request linked the wallet first.
//
// The claim runs under READ COMMITTED, so a request that authenticated with a
// pre-claim key can still commit a new agent / execution token / Slack install
// while the claim is in flight. A post-commit sweep repeats the revocations to
// catch those rows; by then mgmtKeyHash is null and every agent key is dead, so
// no new request can authenticate. Residual window: a request authenticated
// before the claim committed whose write lands after the sweep. Closing that
// fully needs the data plane to re-check agent.isActive at use time (the gateway
// and /authorize do via authenticateAgent; /credentials/inject is PR #310).
async function claimWallet(walletId: string, userId: string) {
  const wallet = await db.$transaction(async (tx) => {
    const claimed = await tx.wallet.updateMany({
      where: { id: walletId, userId: null },
      data: { userId, mgmtKeyHash: null, mgmtKeyPrefix: null },
    })
    if (claimed.count === 0) return null

    const revoked = await revokePreClaimAccess(tx, walletId)
    log.info("wallet claimed; pre-claim keys rotated", { walletId, userId, ...revoked })
    return tx.wallet.findUnique({ where: { id: walletId } })
  })
  if (!wallet) return null

  // Fails closed: if the sweep throws, the claim is not handed back this render.
  const swept = await withTenant(walletId, (tx) => revokePreClaimAccess(tx, walletId))
  if (Object.values(swept).some((n) => n > 0)) {
    log.warn("wallet claim sweep caught rows committed during the claim", { walletId, ...swept })
  }
  return wallet
}

async function revokePreClaimAccess(tx: Prisma.TransactionClient, walletId: string) {
  // Set-based so rows can't slip between a read and per-row writes. The new
  // hash contains ':' so it can never equal a sha256 hex digest (hashApiKey).
  const agentsRotated = await tx.$executeRaw`
    UPDATE "Agent"
    SET "apiKeyHash" = 'claimed:' || gen_random_uuid(), "apiKeyPrefix" = 'claimed', "isActive" = false
    WHERE "walletId" = ${walletId} AND "apiKeyHash" NOT LIKE 'claimed:%'`
  const tokens = await tx.executionToken.updateMany({
    where: { walletId, status: "active" },
    data: { status: "revoked", revokedAt: new Date() },
  })
  const members = await tx.walletMember.updateMany({
    where: { walletId, status: { not: "revoked" } },
    data: { status: "revoked", tokenHash: null, tokenExpiresAt: null },
  })
  const webhooks = await tx.webhook.updateMany({ where: { walletId, isActive: true }, data: { isActive: false } })
  // SlackInstall is FORCE RLS — scope this transaction to the tenant first.
  await scopeTenant(tx, walletId)
  const slack = await tx.slackInstall.updateMany({
    where: { walletId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return {
    agentsRotated,
    tokensRevoked: tokens.count,
    membersRevoked: members.count,
    webhooksDeactivated: webhooks.count,
    slackInstallsRevoked: slack.count,
  }
}

export async function getSessionWallet() {
  // Social session first. Guarded so a not-yet-configured Better Auth (missing
  // env on a fresh deploy) can never break the legacy key / magic-link login.
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (session?.user) {
      const preferred = (await cookies()).get(ACTIVE_WALLET_COOKIE)?.value ?? null
      return resolveWalletForUser(session.user, preferred)
    }
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
      const preferred = (await cookies()).get(ACTIVE_WALLET_COOKIE)?.value ?? null
      const wallet = await resolveWalletForUser(session.user, preferred)
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
 * part 1, re-landed 2026-07-17 after the 2026-07-16 revert — the role matrix
 * was confirmed: admin floor on every mutation except mgmt-key reset, which is
 * owner-only since 2026-09-25 (an sk_ session is role "owner");
 * pack preview / draft simulation stay open to any session). Returns null —
 * the same denial a mutating action already gives an anonymous visitor —
 * when the member's role doesn't meet `min`, so every "if (!wallet) return"
 * early-return in the dashboard actions keeps working unchanged. A viewer
 * gets the same no-op as someone not signed in at all; they never reach the
 * write.
 */
export async function requireSessionRole(min: WalletRole) {
  const member = await getSessionMember()
  if (!member || !hasRole(member.role, min)) return null
  return member.wallet
}

/**
 * Every wallet the current session may act as: owned wallets at "owner", plus
 * active memberships at their stored role. A legacy sk_ session is exactly one
 * wallet (the key IS the wallet) — no switching. Drives the sidebar switcher
 * and validates switchWalletAction; anything not in this list is unreachable.
 */
export async function listSessionWallets(): Promise<Array<{ id: string; name: string; role: WalletRole }>> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (session?.user) {
      const [owned, memberships] = await Promise.all([
        db.wallet.findMany({ where: { userId: session.user.id }, select: { id: true, name: true } }),
        db.walletMember.findMany({
          where: { userId: session.user.id, status: "active" },
          select: { role: true, wallet: { select: { id: true, name: true } } },
        }),
      ])
      const out: Array<{ id: string; name: string; role: WalletRole }> = owned.map((w) => ({
        id: w.id,
        name: w.name,
        role: "owner" as const,
      }))
      for (const m of memberships) {
        if (!out.some((w) => w.id === m.wallet.id)) {
          out.push({ id: m.wallet.id, name: m.wallet.name, role: m.role as WalletRole })
        }
      }
      return out
    }
  } catch {
    // fall through to the management-key path
  }

  const raw = (await cookies()).get(SESSION_COOKIE)?.value
  if (raw) {
    const wallet = await db.wallet.findUnique({ where: { mgmtKeyHash: hashApiKey(raw) } })
    if (wallet) return [{ id: wallet.id, name: wallet.name, role: "owner" }]
  }
  return []
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
