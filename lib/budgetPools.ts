export type PoolStatus = "cap_missing" | "over_cap" | "hot" | "warm" | "clear"

export type AllocationMove = {
  id: string
  title: string
  detail: string
  impact: string
  tone: "emerald" | "amber" | "red" | "zinc"
}

export type AllocationInput = {
  capUsd: number | null
  spendTodayUsd: number
  delegatedDailyUsd: number
  activeGrantUsd: number
  pendingApprovals: number
  deniedMonth: number
  escalatedMonth: number
  modelCount: number
  largestModelShare: number
}

function jsonNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function grantAuthorityUsd(resource: unknown, constraints: unknown): number {
  const resourceRecord = resource && typeof resource === "object" && !Array.isArray(resource) ? resource as Record<string, unknown> : {}
  const constraintsRecord = constraints && typeof constraints === "object" && !Array.isArray(constraints) ? constraints as Record<string, unknown> : {}
  return jsonNumber(constraintsRecord.max_amount_usd) ?? jsonNumber(resourceRecord.amount_usd) ?? 0
}

export function spendCapPressure(spendTodayUsd: number, capUsd: number | null): number | null {
  if (capUsd === null || capUsd <= 0) return null
  return Math.max(0, spendTodayUsd / capUsd)
}

export function poolStatus(spendTodayUsd: number, capUsd: number | null): PoolStatus {
  const pressure = spendCapPressure(spendTodayUsd, capUsd)
  if (pressure === null) return "cap_missing"
  if (pressure >= 1) return "over_cap"
  if (pressure >= 0.8) return "hot"
  if (pressure >= 0.5) return "warm"
  return "clear"
}

export function allocationMoves(input: AllocationInput): AllocationMove[] {
  const moves: AllocationMove[] = []
  const pressure = spendCapPressure(input.spendTodayUsd, input.capUsd)

  if (input.capUsd === null) {
    moves.push({
      id: "set-pool-cap",
      title: "Set a root pool cap",
      detail: "Agent limits exist, but this pool has no hard subtree ceiling yet.",
      impact: "Turns delegated authority into a real enterprise budget.",
      tone: "amber",
    })
  }

  if (pressure !== null && pressure >= 0.8) {
    moves.push({
      id: "reduce-hot-pool",
      title: "Cool this pool before more grants land",
      detail: "Today's approved spend is already near the hard cap.",
      impact: "Route low-priority work elsewhere or lower agent overrides.",
      tone: pressure >= 1 ? "red" : "amber",
    })
  }

  if (input.capUsd !== null && input.delegatedDailyUsd > input.capUsd * 1.25) {
    moves.push({
      id: "right-size-delegation",
      title: "Right-size delegated authority",
      detail: "The sum of active agent daily limits is materially above the pool cap.",
      impact: "Prevents approvals from promising more autonomy than the pool can fund.",
      tone: "amber",
    })
  }

  if (input.capUsd !== null && input.activeGrantUsd > Math.max(0, input.capUsd - input.spendTodayUsd)) {
    moves.push({
      id: "grant-exposure",
      title: "Review outstanding grant exposure",
      detail: "Active grants could consume more than the remaining spend cap.",
      impact: "Revoke, shorten, or split grants before they collide with the cap.",
      tone: "red",
    })
  }

  if (input.pendingApprovals > 0 || input.escalatedMonth > 0) {
    moves.push({
      id: "approval-aware-allocation",
      title: "Add approval-aware lanes",
      detail: "Repeat escalations are a signal to pre-authorize safe recurring work.",
      impact: "Cuts human interruption without relaxing hard limits.",
      tone: "emerald",
    })
  }

  if (input.deniedMonth > 0) {
    moves.push({
      id: "denial-patterns",
      title: "Inspect denial patterns",
      detail: "Denied actions show either healthy containment or mis-sized budgets.",
      impact: "Use the denial log to tune categories, per-transaction limits, or pool caps.",
      tone: "zinc",
    })
  }

  if (input.modelCount > 1 && input.largestModelShare >= 0.7) {
    moves.push({
      id: "vendor-hedge",
      title: "Hedge model concentration",
      detail: "Most token cost is concentrated in one model family.",
      impact: "Move low-risk batch work to a cost-floor route while protecting quality gates.",
      tone: "emerald",
    })
  }

  if (moves.length === 0) {
    moves.push({
      id: "hold-strategy",
      title: "Hold current allocation",
      detail: "Spend, grants, approvals, and routing all look inside the current envelope.",
      impact: "Keep observing before changing policy.",
      tone: "zinc",
    })
  }

  return moves.slice(0, 5)
}
