export type PoolAccessTx = {
  wallet: {
    findUnique(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null>
    findMany(args: { where: { parentId: { in: string[] } }; select: { id: true; parentId: true } }): Promise<Array<{ id: string; parentId: string | null }>>
  }
  agent: {
    findUnique<T extends { where: { id: string } }>(args: T): Promise<({ id: string; walletId: string } & Record<string, unknown>) | null>
  }
}

const MAX_SUBTREE_DEPTH = 32
const MAX_SUBTREE_NODES = 500

export async function walletSubtreeIds(tx: PoolAccessTx, rootWalletId: string): Promise<string[]> {
  const root = await tx.wallet.findUnique({ where: { id: rootWalletId }, select: { id: true } })
  if (!root) return []

  const ids = [root.id]
  const seen = new Set(ids)
  let frontier = [root.id]

  for (let depth = 0; depth < MAX_SUBTREE_DEPTH && frontier.length; depth++) {
    const children = await tx.wallet.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true, parentId: true },
    })
    const next: string[] = []
    for (const child of children) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      ids.push(child.id)
      next.push(child.id)
      if (ids.length >= MAX_SUBTREE_NODES) return ids
    }
    frontier = next
  }

  return ids
}

export async function walletIsInSubtree(tx: PoolAccessTx, rootWalletId: string, candidateWalletId: string): Promise<boolean> {
  const ids = await walletSubtreeIds(tx, rootWalletId)
  return ids.includes(candidateWalletId)
}

export async function agentIsInWalletSet<T extends { id: string; walletId: string }>(
  tx: PoolAccessTx,
  agentId: string,
  walletIds: Iterable<string>,
): Promise<T | null> {
  const allowed = new Set(walletIds)
  const agent = await tx.agent.findUnique({
    where: { id: agentId },
    select: { id: true, walletId: true },
  })
  if (!agent || !allowed.has(agent.walletId)) return null
  return agent as T
}
