import { describe, it, expect } from "vitest"
import { bindMandateRow, evaluateMandate, MANDATE_INVALID, type MandateTokenRow } from "../lib/mandate"

const NOW = new Date("2026-08-12T18:00:00.000Z")

function row(over: Partial<MandateTokenRow> = {}): MandateTokenRow {
  return {
    id: "jti_1",
    walletId: "wal_1",
    agentId: "agt_1",
    status: "active",
    revokedAt: null,
    expiresAt: new Date("2026-08-12T18:15:00.000Z"),
    issuedAt: new Date("2026-08-12T18:00:00.000Z"),
    spentUsd: 4,
    budgetUsd: 25,
    scope: ["STRIPE_KEY"],
    clearance: 3,
    ...over,
  }
}

describe("evaluateMandate", () => {
  it("returns active remaining budget when the row is live and unfrozen", () => {
    expect(evaluateMandate({ token: row(), freezeFrozen: false, now: NOW })).toEqual({
      valid: true,
      status: "active",
      wallet_id: "wal_1",
      agent_id: "agt_1",
      clearance: 3,
      budget_usd: 25,
      spent_usd: 4,
      remaining_usd: 21,
      scope: ["STRIPE_KEY"],
      expires_at: "2026-08-12T18:15:00.000Z",
      issued_at: "2026-08-12T18:00:00.000Z",
    })
  })

  it("fails closed on a missing row without echoing claims", () => {
    expect(evaluateMandate({ token: null, freezeFrozen: false, now: NOW })).toEqual(MANDATE_INVALID)
  })

  it("revoked beats expiry and freeze", () => {
    const view = evaluateMandate({
      token: row({ revokedAt: NOW, status: "revoked", expiresAt: new Date("2026-08-12T17:00:00.000Z") }),
      freezeFrozen: true,
      now: NOW,
    })
    expect(view.status).toBe("revoked")
    expect(view.valid).toBe(false)
    expect(view.scope).toBeUndefined()
  })

  it("expired when the row is past expiresAt", () => {
    const view = evaluateMandate({
      token: row({ expiresAt: new Date("2026-08-12T17:59:00.000Z") }),
      freezeFrozen: false,
      now: NOW,
    })
    expect(view).toMatchObject({ valid: false, status: "expired", wallet_id: "wal_1" })
  })

  it("frozen when the wallet (or ancestor) is frozen", () => {
    const view = evaluateMandate({ token: row(), freezeFrozen: true, now: NOW })
    expect(view).toMatchObject({ valid: false, status: "frozen", reason: "Wallet is frozen" })
  })

  it("never reports negative remaining", () => {
    const view = evaluateMandate({
      token: row({ spentUsd: 40, budgetUsd: 25 }),
      freezeFrozen: false,
      now: NOW,
    })
    expect(view.remaining_usd).toBe(0)
  })
})

describe("bindMandateRow", () => {
  const claims = { jti: "jti_1", wallet: "wal_1", agent: "agt_1" }

  it("accepts a row that matches jti, wallet, and agent", () => {
    expect(bindMandateRow(row(), claims)?.id).toBe("jti_1")
  })

  it("rejects a foreign wallet or agent even if the jti collides", () => {
    expect(bindMandateRow(row({ walletId: "wal_other" }), claims)).toBeNull()
    expect(bindMandateRow(row({ agentId: "agt_other" }), claims)).toBeNull()
    expect(bindMandateRow(row({ id: "jti_other" }), claims)).toBeNull()
    expect(bindMandateRow(null, claims)).toBeNull()
  })
})
