import { describe, expect, it } from "vitest"
import { isWalletStatusResult, renderWalletStatus, walletStatusFailureText } from "../lib/mcpWalletStatus"

const VALID_STATS = {
  today: { token_cost_usd: 1.23456, spend_usd: 12.3 },
  month: { token_cost_usd: 4.5, spend_usd: 67 },
  pending_approvals: 2,
}

describe("MCP wallet status guard", () => {
  it("formats only complete wallet stats as healthy status text", () => {
    expect(isWalletStatusResult(VALID_STATS)).toBe(true)

    expect(renderWalletStatus(VALID_STATS)).toEqual({
      ok: true,
      text: [
        "Today - tokens: $1.23 | spend: $12.30",
        "Month - tokens: $4.50 | spend: $67.00",
        "Attention: 2 pending approval(s)",
      ].join("\n"),
    })
  })

  it("reports no pending approvals when the wallet is healthy with zero pending items", () => {
    const rendered = renderWalletStatus({ ...VALID_STATS, pending_approvals: 0 })
    expect(rendered.ok).toBe(true)
    expect(rendered.text).toContain("No pending approvals")
    expect(rendered.text).toContain("Today - tokens: $1.23")
  })

  it("turns JSON API errors into status-unknown errors, not empty healthy status", () => {
    const rendered = renderWalletStatus({ error: "Unauthorized: management key or wallet agent key required" })

    expect(rendered.ok).toBe(false)
    expect(rendered.text).toBe("Status unknown: Unauthorized: management key or wallet agent key required")
    expect(rendered.text).not.toContain("No pending approvals")
    expect(rendered.text).not.toContain("$undefined")
  })

  it("rejects partial or malformed wallet stats", () => {
    expect(isWalletStatusResult({ today: VALID_STATS.today, pending_approvals: 0 })).toBe(false)
    expect(isWalletStatusResult({ ...VALID_STATS, month: { token_cost_usd: Number.NaN, spend_usd: 1 } })).toBe(false)
    expect(isWalletStatusResult({ ...VALID_STATS, pending_approvals: -1 })).toBe(false)
  })

  it("uses a generic status-unknown message when Sanction returns an unexpected shape", () => {
    expect(walletStatusFailureText({ today: {}, month: {} })).toBe(
      "Status unknown: Sanction returned an unexpected wallet status response.",
    )
  })
})
