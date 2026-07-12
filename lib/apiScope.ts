import type { NextRequest } from "next/server"
import { subtreeWalletIds } from "./walletSubtree"

// Opt-in subtree rollup for management-plane read routes. By default a read is
// exact — it covers only the addressed wallet's own agents — so existing API
// consumers see no change. `?scope=subtree` widens the read to the wallet and
// every pool beneath it (the same bounded CTE the dashboard uses), so a parent
// wallet's owner can pull org-wide stats, reporting, and audit in one call.
//
// Authorization is unchanged: the caller is already authenticated as the owner
// of the addressed wallet, and the subtree is that wallet's own descendants —
// widening down the tree the owner already governs, never up or sideways.

export type ReadScope = "wallet" | "subtree"

export function readScope(req: NextRequest): ReadScope {
  return req.nextUrl.searchParams.get("scope") === "subtree" ? "subtree" : "wallet"
}

/** The wallet-id set a scoped read should cover, plus whether the subtree hit
 *  the node bound. `wallet` scope returns exactly `[walletId]`. */
export async function scopedWalletIds(
  walletId: string,
  scope: ReadScope,
): Promise<{ walletIds: string[]; truncated: boolean }> {
  if (scope === "wallet") return { walletIds: [walletId], truncated: false }
  const { ids, truncated } = await subtreeWalletIds(walletId)
  return { walletIds: ids, truncated }
}
