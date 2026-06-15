import { NextRequest } from "next/server"
import { timingSafeEqual } from "crypto"
import { db } from "./db"
import { hashApiKey } from "./apiKey"

/**
 * Management-plane authentication.
 *
 * Gates owner-only operations (create agents, manage the vault, manage policy,
 * read stats). Requires the wallet's management key (sk_ prefix) supplied via
 * `x-mgmt-key` header or `Authorization: Bearer sk_...`.
 *
 * Fails CLOSED: a wallet with no management key set (e.g. created before auth
 * existed) cannot be managed via the API until bootstrapped through
 * POST /wallets/bootstrap-key. This is deliberate — denying the owner is far
 * safer than allowing an attacker.
 *
 * Note: `walletId` is treated as non-secret; authorization rests entirely on
 * the management key, never on knowledge of the id.
 */
export async function authenticateOwner(req: NextRequest, walletId: string) {
  if (!walletId) return { wallet: null, error: "wallet_id required", status: 400 as const }

  const header = req.headers.get("x-mgmt-key") ?? bearer(req)
  if (!header) return { wallet: null, error: "Missing management key (x-mgmt-key)", status: 401 as const }

  const wallet = await db.wallet.findUnique({ where: { id: walletId } })
  if (!wallet) return { wallet: null, error: "Wallet not found", status: 404 as const }
  if (!wallet.mgmtKeyHash) {
    return { wallet: null, error: "Wallet has no management key set; bootstrap it first", status: 403 as const }
  }

  if (!constantTimeEqualHex(hashApiKey(header), wallet.mgmtKeyHash)) {
    return { wallet: null, error: "Invalid management key", status: 401 as const }
  }

  return { wallet, error: null, status: 200 as const }
}

function bearer(req: NextRequest): string | null {
  const auth = req.headers.get("authorization")
  if (auth?.startsWith("Bearer ") && auth.slice(7).startsWith("sk_")) return auth.slice(7)
  return null
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  } catch {
    return false
  }
}
