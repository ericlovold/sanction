import { fmtUsd } from "./format"

export type WalletStatusResult = {
  agent_name?: string
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
  | { ok: true; text: string; data: WalletStatusResult }
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

  // Keep only the caller display label and budget summary in model context.
  const agentName = typeof result.agent_name === "string" && result.agent_name.trim()
    ? result.agent_name : undefined
  const data: WalletStatusResult = {
    ...(agentName ? { agent_name: agentName } : {}),
    today: { token_cost_usd: result.today.token_cost_usd, spend_usd: result.today.spend_usd },
    month: { token_cost_usd: result.month.token_cost_usd, spend_usd: result.month.spend_usd },
    pending_approvals: result.pending_approvals,
  }
  return {
    ok: true,
    data,
    text: [
      ...(agentName ? [`Agent: ${JSON.stringify(agentName)}`] : []),
      `Today - tokens: ${fmtUsd(result.today.token_cost_usd)} | spend: ${fmtUsd(result.today.spend_usd)}`,
      `Month - tokens: ${fmtUsd(result.month.token_cost_usd)} | spend: ${fmtUsd(result.month.spend_usd)}`,
      result.pending_approvals > 0 ? `Attention: ${result.pending_approvals} pending approval(s)` : "No pending approvals",
    ].join("\n"),
  }
}
