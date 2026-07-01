// Account-tree rollup — pure. Given a flat list of nodes (each with its OWN
// spend) and a root id, build the nested subtree and roll spend UP: each node's
// `rollup` = its own spend + every descendant's. Read-only reporting;
// /authorize enforces opt-in subtree caps. Cycle- and depth-safe.

export type NodeSpend = { today_usd: number; month_usd: number; token_today_usd: number }
export type FlatNode = { id: string; parentId: string | null; name: string; spend: NodeSpend }
export type TreeNode = {
  id: string
  name: string
  parent_id: string | null
  spend: NodeSpend // this node's own agents
  rollup: NodeSpend // this node + all descendants
  children: TreeNode[]
}

export function emptySpend(): NodeSpend {
  return { today_usd: 0, month_usd: 0, token_today_usd: 0 }
}

function addSpend(a: NodeSpend, b: NodeSpend): NodeSpend {
  return {
    today_usd: round(a.today_usd + b.today_usd),
    month_usd: round(a.month_usd + b.month_usd),
    token_today_usd: round(a.token_today_usd + b.token_today_usd),
  }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6 // kill float dust from summing

/** Build the subtree rooted at `rootId` with spend rolled up. Null if root absent. */
export function buildRollupTree(nodes: FlatNode[], rootId: string): TreeNode | null {
  const childrenOf = new Map<string, FlatNode[]>()
  for (const n of nodes) {
    if (n.parentId == null) continue
    if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, [])
    childrenOf.get(n.parentId)!.push(n)
  }
  const root = nodes.find((n) => n.id === rootId)
  if (!root) return null

  const seen = new Set<string>() // cycle guard — never visit a node twice
  function build(node: FlatNode): TreeNode {
    seen.add(node.id)
    const kids = (childrenOf.get(node.id) ?? []).filter((k) => !seen.has(k.id)).map(build)
    const rollup = kids.reduce((acc, c) => addSpend(acc, c.rollup), { ...node.spend })
    return { id: node.id, name: node.name, parent_id: node.parentId, spend: node.spend, rollup, children: kids }
  }
  return build(root)
}
