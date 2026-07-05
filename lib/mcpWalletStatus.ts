export type WalletStatusResult = {
  today: {
    token_cost_usd: number
    spend_usd: number
  }
  month: {
    token_cost_usd: number
    spend_usd: number
  }
  pending_approvals: number
}

type WalletStatusRender =
  | { ok: true; text: string }
  | { ok: false; text: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

export function isWalletStatusResult(value: unknown): value is WalletStatusResult {
  if (!isRecord(value) || !isRecord(value.today) || !isRecord(value.month)) return false
  return (
    isFiniteNumber(value.today.token_cost_usd) &&
    isFiniteNumber(value.today.spend_usd) &&
    isFiniteNumber(value.month.token_cost_usd) &&
    isFiniteNumber(value.month.spend_usd) &&
    isNonNegativeInteger(value.pending_approvals)
  )
}

export function walletStatusFailureText(result: unknown): string {
  if (isRecord(result)) {
    const detail = result.reason ?? result.error ?? result.message
    if (typeof detail === "string" && detail.trim()) {
      return `Status unknown: ${detail}`
    }
  }
  return "Status unknown: Sanction returned an unexpected wallet status response."
}

export function renderWalletStatus(result: unknown): WalletStatusRender {
  if (!isWalletStatusResult(result)) {
    return { ok: false, text: walletStatusFailureText(result) }
  }

  return {
    ok: true,
    text: [
      `Today - tokens: $${result.today.token_cost_usd.toFixed(4)} | spend: $${result.today.spend_usd.toFixed(2)}`,
      `Month - tokens: $${result.month.token_cost_usd.toFixed(4)} | spend: $${result.month.spend_usd.toFixed(2)}`,
      result.pending_approvals > 0 ? `Attention: ${result.pending_approvals} pending approval(s)` : "No pending approvals",
    ].join("\n"),
  }
}
