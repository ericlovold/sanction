import { cookies } from "next/headers"
import { db } from "./db"
import { hashApiKey } from "./apiKey"

// Lightweight session: the cookie holds the wallet's management key (httpOnly,
// 30-day). The server hashes it to resolve the wallet — the client never
// supplies a wallet id, so there's no way to view someone else's wallet.
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
}

export async function getSessionWallet() {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value
  if (!raw) return null
  return db.wallet.findUnique({ where: { mgmtKeyHash: hashApiKey(raw) } })
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
