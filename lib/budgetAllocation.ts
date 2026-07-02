export const allocationStrategies = ["equal", "spend", "delegated", "headroom"] as const

export type AllocationStrategy = typeof allocationStrategies[number]

export type AllocationChildInput = {
  id: string
  name: string
  spendTodayCents: number
  delegatedDailyCents: number
}

export type AllocationChildResult = AllocationChildInput & {
  weight: number
  capCents: number
}

export function parseAllocationStrategy(value: FormDataEntryValue | null): AllocationStrategy {
  const raw = String(value ?? "")
  return allocationStrategies.includes(raw as AllocationStrategy) ? raw as AllocationStrategy : "headroom"
}

function weightFor(child: AllocationChildInput, strategy: AllocationStrategy): number {
  switch (strategy) {
    case "spend":
      return Math.max(0, child.spendTodayCents)
    case "delegated":
      return Math.max(0, child.delegatedDailyCents)
    case "headroom":
      return Math.max(0, child.delegatedDailyCents - child.spendTodayCents)
    case "equal":
      return 1
  }
}

export function allocatePoolCaps(
  parentCapCents: number,
  children: AllocationChildInput[],
  strategy: AllocationStrategy,
): AllocationChildResult[] {
  if (!Number.isInteger(parentCapCents) || parentCapCents < 0) {
    throw new Error("Parent cap must be a non-negative cent amount.")
  }
  if (children.length === 0) return []

  const rawWeights = children.map((child) => weightFor(child, strategy))
  const weightTotal = rawWeights.reduce((sum, weight) => sum + weight, 0)
  const weights = weightTotal > 0 ? rawWeights : children.map(() => 1)
  const total = weightTotal > 0 ? weightTotal : children.length

  const ranked = children.map((child, index) => {
    const exact = (parentCapCents * weights[index]) / total
    const capCents = Math.floor(exact)
    return {
      child,
      index,
      weight: weights[index],
      capCents,
      remainder: exact - capCents,
    }
  })

  let remainder = parentCapCents - ranked.reduce((sum, row) => sum + row.capCents, 0)
  for (const row of [...ranked].sort((a, b) => b.remainder - a.remainder || a.child.name.localeCompare(b.child.name) || a.index - b.index)) {
    if (remainder <= 0) break
    row.capCents += 1
    remainder -= 1
  }

  return ranked
    .sort((a, b) => a.index - b.index)
    .map((row) => ({
      ...row.child,
      weight: row.weight,
      capCents: row.capCents,
    }))
}
