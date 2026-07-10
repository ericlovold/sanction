import { db } from "@/lib/db"

// The wallet subtree as ids — one bounded recursive CTE, shared by every
// surface that widens from "this wallet" to "this wallet and everything under
// it" (pools, org-level approvals/audit visibility). Root id is always first.
// Bounds match the /wallets/tree route: enough for any real org, a hard stop
// against a pathological (or cyclic, pre-guard) tree.

export const SUBTREE_MAX_DEPTH = 6
export const SUBTREE_MAX_NODES = 500

export async function subtreeWalletIds(rootId: string): Promise<{ ids: string[]; truncated: boolean }> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE subtree AS (
      SELECT id, "parentId", 1 AS depth FROM "Wallet" WHERE id = ${rootId}
      UNION ALL
      SELECT w.id, w."parentId", s.depth + 1
      FROM "Wallet" w JOIN subtree s ON w."parentId" = s.id
      WHERE s.depth < ${SUBTREE_MAX_DEPTH}
    )
    SELECT id FROM subtree LIMIT ${SUBTREE_MAX_NODES + 1}
  `
  const truncated = rows.length > SUBTREE_MAX_NODES
  const ids = rows.slice(0, SUBTREE_MAX_NODES).map((r) => r.id)
  // Root first — callers treat ids[0] as the authenticated wallet.
  ids.sort((a, b) => (a === rootId ? -1 : b === rootId ? 1 : 0))
  return { ids, truncated }
}
