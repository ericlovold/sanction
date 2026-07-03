import { describe, it, expect } from "vitest"
import { SanctionClient } from "./client"
import { evaluateLocally } from "./localPolicy"
import { AuthorizationDeniedError } from "./errors"
import type { Fetch, PolicyInput } from "./types"

// Dollars, matching PolicyInput (the SDK speaks dollars; the API stores cents).
const POLICY: PolicyInput = {
  perTransactionMaxUsd: 20,
  escalateOverUsd: 5,
  dailySpendBudgetUsd: 50,
  blockedCategories: ["gambling"],
  allowedCategories: ["software"],
}

const buy = (amountUsd: number, category = "software") =>
  ({ action: "purchase" as const, amountUsd, merchant: "anthropic", category })

describe("evaluateLocally (mirrors server decision order)", () => {
  it("approves within all limits", () => {
    expect(evaluateLocally(POLICY, buy(3), 0).status).toBe("approved")
  })
  it("escalates over the escalation threshold", () => {
    expect(evaluateLocally(POLICY, buy(9), 0)).toMatchObject({ status: "escalated", code: "ESCALATION_REQUIRED" })
  })
  it("denies over the per-transaction max", () => {
    expect(evaluateLocally(POLICY, buy(25), 0)).toMatchObject({ status: "denied", code: "PER_TXN_LIMIT" })
  })
  it("denies a blocked category (blocklist wins)", () => {
    expect(evaluateLocally(POLICY, buy(1, "gambling"), 0)).toMatchObject({ status: "denied", code: "CATEGORY_BLOCKED" })
  })
  it("denies a category not on a non-empty allowlist", () => {
    expect(evaluateLocally(POLICY, buy(1, "research"), 0)).toMatchObject({ status: "denied", code: "CATEGORY_NOT_ALLOWED" })
  })
  it("denies when the daily budget would be exceeded", () => {
    expect(evaluateLocally(POLICY, buy(2), 49)).toMatchObject({ status: "denied", code: "DAILY_BUDGET_EXCEEDED" })
  })
  it("auto-approve floor wins over escalation", () => {
    // $4 is over the $5 escalate line? no — but with a $6 floor, a $6 charge
    // auto-approves even though it's over a $5 escalate line.
    const p: PolicyInput = { autoApproveUnderUsd: 6, escalateOverUsd: 5, perTransactionMaxUsd: 100 }
    expect(evaluateLocally(p, buy(6), 0).status).toBe("approved")
  })
})

// fetch that always throws (Sanction unreachable)
const downFetch = (() => {
  throw new Error("ECONNREFUSED")
}) as unknown as Fetch

describe("SanctionClient local-first fallback", () => {
  it("decides locally against localPolicy when the network is down", async () => {
    const c = new SanctionClient("pxy_x", { fetch: downFetch, localPolicy: POLICY })
    const d = await c.authorize(buy(3))
    expect(d.status).toBe("approved")
    expect(d.decidedLocally).toBe(true)
    expect(c.pendingOfflineDecisions()).toBe(1)
  })

  it("offline mode decides locally without touching the network", async () => {
    const c = new SanctionClient("pxy_x", { fetch: downFetch, localPolicy: POLICY, offline: true })
    expect((await c.authorize(buy(9))).status).toBe("escalated")
    expect((await c.authorize(buy(25))).status).toBe("denied")
  })

  it("fails CLOSED (deny) when unreachable with no local policy", async () => {
    const c = new SanctionClient("pxy_x", { fetch: downFetch }) // failClosed defaults true
    const d = await c.authorize(buy(3))
    expect(d).toMatchObject({ status: "denied", code: "POLICY_DENIED", decidedLocally: true })
  })

  it("can fail OPEN when explicitly configured", async () => {
    const c = new SanctionClient("pxy_x", { fetch: downFetch, failClosed: false })
    expect((await c.authorize(buy(3))).status).toBe("approved")
  })

  it("still honors throwOnDeny for local denials", async () => {
    const c = new SanctionClient("pxy_x", { fetch: downFetch, localPolicy: POLICY })
    await expect(c.authorize(buy(1, "gambling"), { throwOnDeny: true })).rejects.toBeInstanceOf(AuthorizationDeniedError)
  })

  it("enforces the daily budget locally across calls", async () => {
    const c = new SanctionClient("pxy_x", { fetch: downFetch, localPolicy: { dailySpendBudgetUsd: 10, escalateOverUsd: 1000, perTransactionMaxUsd: 1000 } })
    expect((await c.authorize(buy(7))).status).toBe("approved") // $7 spent
    expect((await c.authorize(buy(7))).status).toBe("denied") // 7+7 > 10
  })
})

// fetch whose behavior flips from "down" to "ok" — to test audit catch-up.
function flippableFetch() {
  const state = { down: true, calls: [] as string[] }
  const fetch = (async (url: string, init: RequestInit = {}) => {
    if (state.down) throw new Error("ECONNREFUSED")
    state.calls.push(String((init.headers as Record<string, string>)?.["idempotency-key"]))
    return { ok: true, status: 200, text: async () => JSON.stringify({ authorized: true, status: "approved", request_id: "r", agent: "a", amount_usd: 1, merchant: "m" }) } as Response
  }) as unknown as Fetch
  return { fetch, state }
}

describe("syncOfflineDecisions", () => {
  it("replays queued local decisions once the network returns", async () => {
    const { fetch, state } = flippableFetch()
    const c = new SanctionClient("pxy_x", { fetch, localPolicy: POLICY })

    await c.authorize({ ...buy(3), idempotencyKey: "job-1" }) // network down -> local approve, queued
    await c.authorize({ ...buy(4), idempotencyKey: "job-2" })
    expect(c.pendingOfflineDecisions()).toBe(2)

    state.down = false
    const synced = await c.syncOfflineDecisions()
    expect(synced).toBe(2)
    expect(c.pendingOfflineDecisions()).toBe(0)
    expect(state.calls).toEqual(["job-1", "job-2"]) // replayed with idempotency keys
  })

  it("keeps queued decisions when replay returns a non-decision server error", async () => {
    let calls = 0
    const fetch = (async () => {
      calls++
      if (calls === 1) throw new Error("ECONNREFUSED")
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: "server down" }),
      } as Response
    }) as unknown as Fetch
    const c = new SanctionClient("pxy_x", { fetch, localPolicy: POLICY })

    await c.authorize({ ...buy(3), idempotencyKey: "job-1" })
    expect(c.pendingOfflineDecisions()).toBe(1)

    expect(await c.syncOfflineDecisions()).toBe(0)
    expect(c.pendingOfflineDecisions()).toBe(1)
  })

  it("surfaces auth failures during replay without dropping the queued decision", async () => {
    let calls = 0
    const fetch = (async () => {
      calls++
      if (calls === 1) throw new Error("ECONNREFUSED")
      return {
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: "Invalid API key" }),
      } as Response
    }) as unknown as Fetch
    const c = new SanctionClient("pxy_x", { fetch, localPolicy: POLICY })
    await c.authorize({ ...buy(3), idempotencyKey: "job-1" })

    await expect(c.syncOfflineDecisions()).rejects.toMatchObject({ name: "SanctionError" })
    expect(c.pendingOfflineDecisions()).toBe(1)
  })
})
