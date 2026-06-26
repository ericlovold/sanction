import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"
import { buildRollupTree, emptySpend, type FlatNode, type NodeSpend } from "@/lib/accountTree"

export const dynamic = "force-dynamic"

const MAX_DEPTH = 6
const MAX_NODES = 500
const noStore = { "cache-control": "no-store" }

// Read-only spend rollup across a wallet's account subtree (management plane).
// Each node shows its own spend plus the rolled-up total of its whole subtree —
// the "one number for the fleet" view. Bounded depth/nodes. No enforcement here.
export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400, headers: noStore })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status, headers: noStore })

  // BFS the subtree from the authenticated root (bounded depth + node count).
  type W = { id: string; parentId: string | null; name: string }
  const root: W = { id: owner.wallet.id, parentId: owner.wallet.parentId, name: owner.wallet.name }
  const wallets: W[] = [root]
  let frontier = [root.id]
  let truncated = false
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const kids = await db.wallet.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true, parentId: true, name: true },
    })
    if (!kids.length) break
    if (wallets.length + kids.length > MAX_NODES) {
      truncated = true
      break
    }
    wallets.push(...kids)
    frontier = kids.map((k) => k.id)
  }

  const walletIds = wallets.map((w) => w.id)

  // Aggregate spend per agent, then roll each agent's spend up to its wallet.
  const agents = await db.agent.findMany({ where: { walletId: { in: walletIds } }, select: { id: true, walletId: true } })
  const agentToWallet = new Map(agents.map((a) => [a.id, a.walletId]))
  const agentIds = agents.map((a) => a.id)

  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const spendByWallet = new Map<string, NodeSpend>()
  const bump = (wid: string | undefined, patch: Partial<NodeSpend>) => {
    if (!wid) return
    const cur = spendByWallet.get(wid) ?? emptySpend()
    spendByWallet.set(wid, {
      today_usd: cur.today_usd + (patch.today_usd ?? 0),
      month_usd: cur.month_usd + (patch.month_usd ?? 0),
      token_today_usd: cur.token_today_usd + (patch.token_today_usd ?? 0),
    })
  }

  if (agentIds.length) {
    const [tokToday, spendToday, spendMonth] = await Promise.all([
      db.tokenLog.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds }, createdAt: { gte: dayStart } }, _sum: { costUsd: true } }),
      db.authorizationRequest.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: dayStart } }, _sum: { amountUsd: true } }),
      db.authorizationRequest.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds }, status: "approved", createdAt: { gte: monthStart } }, _sum: { amountUsd: true } }),
    ])
    for (const r of tokToday) bump(agentToWallet.get(r.agentId), { token_today_usd: r._sum.costUsd ?? 0 })
    for (const r of spendToday) bump(agentToWallet.get(r.agentId), { today_usd: r._sum.amountUsd ?? 0 })
    for (const r of spendMonth) bump(agentToWallet.get(r.agentId), { month_usd: r._sum.amountUsd ?? 0 })
  }

  const flat: FlatNode[] = wallets.map((w) => ({ id: w.id, parentId: w.parentId, name: w.name, spend: spendByWallet.get(w.id) ?? emptySpend() }))
  const tree = buildRollupTree(flat, root.id)

  return NextResponse.json({ wallet_id: root.id, nodes: wallets.length, truncated, tree }, { headers: noStore })
}
