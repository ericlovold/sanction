import { randomUUID } from "node:crypto"
import { Client } from "pg"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { generateApiKey } from "@/lib/apiKey"
import { reserveGatewayBudget, resolveGatewayBudget, releaseGatewayBudget } from "@/lib/gatewayBudget"

vi.mock("next/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/server")>()
  return { ...original, after: () => {} }
})
vi.mock("@/lib/thresholds", () => ({ notifyTokenBudgetThreshold: vi.fn() }))

// Real PostgreSQL and real budget transactions; only provider IO and notification
// delivery are stubbed. RUN_DB_TESTS=1 requires a DISPOSABLE database, never prod.
const run = process.env.RUN_DB_TESTS === "1"
const wallets: string[] = []
const model = "claude-haiku-4-5"
const dollarUsage = { model, tokensIn: 1_000_000, tokensOut: 0 }

type WalletOptions = {
  parentId?: string
  daily?: number
  monthly?: number
  pool?: number
  seatDaily?: number
  seatMonthly?: number
}

async function makeWallet(options: WalletOptions = {}) {
  const id = randomUUID()
  const key = generateApiKey()
  const wallet = await db.wallet.create({
    data: {
      id,
      name: "gateway reservation test",
      ownerEmail: `${id}@example.test`,
      parentId: options.parentId,
      policy: { create: {
        dailyTokenBudgetUsd: options.daily ?? 100_000,
        monthlyTokenBudgetUsd: options.monthly,
        subtreeDailyTokenCapUsd: options.pool,
      } },
      agents: { create: {
        name: "reservation seat",
        apiKeyHash: key.hash,
        apiKeyPrefix: key.prefix,
        dailyTokenBudgetUsd: options.seatDaily,
        monthlyTokenBudgetUsd: options.seatMonthly,
      } },
    },
    include: { agents: true },
  })
  wallets.push(wallet.id)
  const agent = await db.agent.findFirstOrThrow({
    where: { id: wallet.agents[0].id, walletId: wallet.id },
    include: { wallet: { include: { policy: true } } },
  })
  return { id: wallet.id, agent, key: key.raw }
}

type TestWallet = Awaited<ReturnType<typeof makeWallet>>
function reserve(wallet: TestWallet, reservedUsd = 1) {
  return reserveGatewayBudget(wallet.agent, { provider: "anthropic", model, reservedUsd })
}

async function admitted(wallet: TestWallet, amount = 1) {
  const result = await reserve(wallet, amount)
  expect(result.exhausted).toBe(false)
  expect(result.reservationId).toEqual(expect.any(String))
  return result.reservationId!
}

async function logTokens(wallet: TestWallet, cost = 1) {
  const { POST } = await import("@/app/api/v1/tokens/route")
  return POST(new NextRequest("https://test.local/api/v1/tokens", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": wallet.key },
    body: JSON.stringify({ model, tokens_in: 1, tokens_out: 0, cost_usd: cost }),
  }))
}

const gatewayBody = { model: "claude-sonnet-5", max_tokens: 1000, messages: [{ role: "user", content: "hi" }] }

async function gatewayRequest(wallet: TestWallet, stream = false) {
  const { POST } = await import("@/app/api/gateway/[provider]/[...path]/route")
  return POST(new NextRequest("https://test.local/api/gateway/anthropic/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-sanction-key": wallet.key,
      "x-api-key": "test-provider-key", "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ ...gatewayBody, ...(stream ? { stream: true } : {}) }),
  }), { params: Promise.resolve({ provider: "anthropic", path: ["v1", "messages"] }) })
}

async function gatewayReservationSize(stream = false) {
  const { prepareGatewayRequest } = await import("@/lib/gatewayRequestBudget")
  return prepareGatewayRequest("anthropic", "v1/messages", new TextEncoder().encode(
    JSON.stringify({ ...gatewayBody, ...(stream ? { stream: true } : {}) }),
  ).buffer).reservedUsd
}

async function reservations(walletIds: string[]) {
  return db.gatewayReservation.findMany({ where: { walletId: { in: walletIds } } })
}

async function logs(walletIds: string[]) {
  return db.tokenLog.findMany({ where: { agent: { walletId: { in: walletIds } } } })
}

// Promise.all rejects before other fixture/transaction writes finish. Drain the
// entire batch before propagating its original error so teardown cannot race it.
async function settleAll<T>(operations: Promise<T>[]): Promise<T[]> {
  const outcomes = await Promise.allSettled(operations)
  return outcomes.map((outcome) => {
    if (outcome.status === "rejected") throw outcome.reason
    return outcome.value
  })
}

type Observed<T> = { promise: Promise<T>; throwIfRejected: () => void }

// Attach the handler when background work starts, before any polling or other
// awaits. The original promise remains awaitable, with its original error.
function observe<T>(promise: Promise<T>): Observed<T> {
  let failure: { reason: unknown } | undefined
  void promise.catch((reason) => { failure = { reason } })
  return { promise, throwIfRejected: () => { if (failure) throw failure.reason } }
}

async function waitUntil(check: () => Promise<boolean>, operations: Observed<unknown>[] = []) {
  const deadline = Date.now() + 4_000
  while (true) {
    operations.forEach((operation) => operation.throwIfRejected())
    const reached = await check()
    operations.forEach((operation) => operation.throwIfRejected())
    if (reached) return
    if (Date.now() > deadline) throw new Error("Timed out waiting for the PostgreSQL concurrency barrier")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function advisoryWaiters(client: Client, key: string, blockerPid: number): Promise<number[]> {
  const { rows } = await client.query<{ pid: number }>(`SELECT pid FROM pg_locks
    WHERE locktype = 'advisory' AND NOT granted
      AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND classid::bigint = CASE WHEN hashtext($1) < 0 THEN 4294967295 ELSE 0 END
      AND objid::bigint = (hashtext($1)::bigint & 4294967295) AND objsubid = 1
      AND $2::int = ANY(pg_blocking_pids(pid))`, [key, blockerPid])
  return rows.map((row) => row.pid)
}

describe.skipIf(!run)("gateway reservations (Postgres)", () => {
  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    if (!wallets.length) return
    const scope = { in: wallets }
    // Delete linked logs first, then reservations, then their owners.
    await db.tokenLog.deleteMany({ where: { agent: { walletId: scope } } })
    await db.gatewayReservation.deleteMany({ where: { walletId: scope } })
    await db.authorizationRequest.deleteMany({ where: { agent: { walletId: scope } } })
    await db.agent.deleteMany({ where: { walletId: scope } })
    await db.policy.deleteMany({ where: { walletId: scope } })
    for (const id of [...wallets].reverse()) await db.wallet.delete({ where: { id } })
    wallets.length = 0
  })

  it("drains concurrent fixture writes before surfacing an earlier rejection", async () => {
    const failure = new Error("fixture batch failed")
    let unblock!: () => void
    const gate = new Promise<void>((resolve) => { unblock = resolve })
    let drained = false
    const batch = observe(settleAll([
      Promise.reject<TestWallet>(failure),
      gate.then(() => makeWallet()),
    ]).finally(() => { drained = true }))
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(drained).toBe(false)
    } finally {
      unblock()
      await Promise.allSettled([batch.promise])
    }
    await expect(batch.promise).rejects.toBe(failure)
    expect(drained).toBe(true)
    expect(await db.wallet.count({ where: { id: { in: wallets } } })).toBe(1)
  })

  it("surfaces a background rejection instead of masking it as a barrier timeout", async () => {
    const failure = new Error("background database operation failed")
    const operation = observe(Promise.reject(failure))
    await expect(waitUntil(async () => false, [operation])).rejects.toBe(failure)
  })

  it("admits exactly five of ten sibling $1 reservations under a $5 parent", async () => {
    const parent = await makeWallet({ pool: 500 })
    const children = await settleAll([
      makeWallet({ parentId: parent.id }), makeWallet({ parentId: parent.id }),
    ])
    const results = await settleAll(Array.from({ length: 10 }, (_, i) => reserve(children[i % 2])))
    const accepted = results.filter((r) => !r.exhausted)
    const denied = results.filter((r) => r.exhausted)
    expect(accepted).toHaveLength(5)
    expect(denied).toHaveLength(5)
    expect(denied).toEqual(Array.from({ length: 5 }, () => expect.objectContaining({
      horizon: "subtree-daily", capWalletId: parent.id, spent: 5, budget: 5,
    })))
    const decisionIds = denied.map((result) => result.decisionId)
    expect(decisionIds).toEqual(Array(5).fill(expect.any(String)))
    expect(new Set(decisionIds).size).toBe(5)
    const receipts = await db.authorizationRequest.findMany({
      where: { agent: { walletId: { in: children.map((child) => child.id) } } },
    })
    expect(receipts.map((receipt) => receipt.id).sort()).toEqual([...decisionIds].sort())
    expect(receipts).toEqual(Array.from({ length: 5 }, () => expect.objectContaining({
      kind: "tool", action: "invoke", status: "denied", amountUsd: 0, decidedAt: expect.any(Date),
      detailsJson: expect.objectContaining({
        source: "gateway", provider: "anthropic", model, horizon: "subtree-daily",
        code: "GATEWAY_BUDGET_EXCEEDED", cap_wallet_id: parent.id,
        limit_usd: 5, occupied_usd: 5, requested_reservation_usd: 1,
      }),
    })))
    expect(await db.pendingApproval.count({ where: {
      walletId: { in: children.map((child) => child.id) },
      sourceType: "authorization_request", sourceId: { in: receipts.map((receipt) => receipt.id) },
    } })).toBe(0)
    const rows = await reservations(children.map((child) => child.id))
    expect(rows).toHaveLength(5)
    expect(rows.reduce((total, row) => total + row.reservedUsd, 0)).toBe(5)
    expect(await logs(children.map((child) => child.id))).toHaveLength(0)

    // A failed attempt must not leave another debit behind: releasing one
    // admitted request opens exactly one slot, even after five failed attempts.
    await releaseGatewayBudget(accepted[0].reservationId!)
    const retries = await settleAll([reserve(children[0]), reserve(children[1])])
    expect(retries.filter((r) => !r.exhausted)).toHaveLength(1)
    expect(retries.filter((r) => r.exhausted)).toHaveLength(1)
  })

  it("enforces the seat daily override across simultaneous requests", async () => {
    const wallet = await makeWallet({ daily: 10_000, seatDaily: 100 })
    const results = await settleAll(Array.from({ length: 6 }, () => reserve(wallet, 0.25)))
    expect(results.filter((r) => !r.exhausted)).toHaveLength(4)
    expect(results.filter((r) => r.exhausted)).toEqual([
      expect.objectContaining({ horizon: "daily", spent: 1, budget: 1 }),
      expect.objectContaining({ horizon: "daily", spent: 1, budget: 1 }),
    ])
    expect(await reservations([wallet.id])).toHaveLength(4)
  })

  it("admits a complete 499-wallet pool and refuses the 500th member without undercounting", async () => {
    const parent = await makeWallet({ pool: 500 })
    const child = await makeWallet({ parentId: parent.id })
    const ids = Array.from({ length: 498 }, () => randomUUID())
    const data = ids.map((id) => ({ id, parentId: parent.id, name: "bounded pool fixture", ownerEmail: `${id}@example.test` }))
    await db.wallet.createMany({ data: data.slice(0, 497) })
    wallets.push(...ids.slice(0, 497))
    await admitted(child)
    await db.wallet.create({ data: data[497] })
    wallets.push(ids[497])
    await expect(reserve(child)).rejects.toThrow("traversal limit")
    expect(await reservations([child.id])).toHaveLength(1)
  })

  it("detects descendants omitted beyond the subtree depth bound", async () => {
    const root = await makeWallet({ pool: 500 })
    const ids = Array.from({ length: 33 }, () => randomUUID())
    const data = ids.map((id, i) => ({ id, parentId: i === 0 ? root.id : ids[i - 1], name: "deep pool fixture", ownerEmail: `${id}@example.test` }))
    await db.wallet.createMany({ data: data.slice(0, 32) })
    wallets.push(...ids.slice(0, 32))
    await admitted(root)
    await db.wallet.create({ data: data[32] })
    wallets.push(ids[32])
    await expect(reserve(root)).rejects.toThrow("Incomplete token pool")
    expect(await reservations([root.id])).toHaveLength(1)
  })

  it("refuses truncated and cyclic ancestry rather than trusting a partial cap chain", async () => {
    const chain = [await makeWallet()]
    for (let i = 1; i < 16; i++) chain.push(await makeWallet({ parentId: chain[i - 1].id }))
    await admitted(chain[15])
    const tooDeep = await makeWallet({ parentId: chain[15].id })
    await expect(reserve(tooDeep)).rejects.toThrow("Incomplete wallet ancestry")
    expect(await reservations([tooDeep.id])).toHaveLength(0)
    try {
      await db.wallet.update({ where: { id: chain[0].id }, data: { parentId: chain[1].id } })
      await expect(reserve(chain[1])).rejects.toThrow("Incomplete wallet ancestry")
      expect(await reservations([chain[1].id])).toHaveLength(0)
    } finally {
      await db.wallet.update({ where: { id: chain[0].id }, data: { parentId: null } })
    }
  })

  it.each([
    ["gateway", "daily"], ["tokens", "daily"],
    ["gateway", "monthly"], ["tokens", "monthly"],
    ["gateway", "subtree-daily"], ["tokens", "subtree-daily"],
  ] as const)("admits three exact $0.10 %s charges under a $0.30 %s cap", async (writer, horizon) => {
    const wallet = await makeWallet(horizon === "daily" ? { daily: 30 }
      : horizon === "monthly" ? { monthly: 30 } : { pool: 30 })
    const results = await settleAll(Array.from({ length: 3 }, async () =>
      writer === "gateway" ? !(await reserve(wallet, 0.1)).exhausted : (await logTokens(wallet, 0.1)).status === 200))
    expect(results).toEqual([true, true, true])
    const next = await reserve(wallet, 0.000001)
    expect(next).toMatchObject({ exhausted: true, horizon, budget: 0.3 })
    expect(next.spent).toBeCloseTo(0.3, 6)
    expect((await logTokens(wallet, 0.000001)).status).toBe(402)
    expect(writer === "gateway" ? await reservations([wallet.id]) : await logs([wallet.id])).toHaveLength(3)
  })

  it("combines prior monthly spend and active holds under the seat monthly override", async () => {
    const wallet = await makeWallet({ monthly: 10_000, seatMonthly: 150 })
    const month = new Date()
    month.setDate(1)
    month.setHours(0, 0, 0, 0)
    await db.tokenLog.create({ data: {
      agentId: wallet.agent.id, model, tokensIn: 1_250_000, tokensOut: 0,
      costUsd: 1.25, createdAt: month,
    } })
    const results = await settleAll(Array.from({ length: 3 }, () => reserve(wallet, 0.25)))
    expect(results.filter((r) => !r.exhausted)).toHaveLength(1)
    expect(results.filter((r) => r.exhausted)).toEqual([
      expect.objectContaining({ horizon: "monthly", spent: 1.5, budget: 1.5 }),
      expect.objectContaining({ horizon: "monthly", spent: 1.5, budget: 1.5 }),
    ])
    expect(await reservations([wallet.id])).toHaveLength(1)
  })

  it("counts only today's logs daily and this month's logs monthly at a fixed midmonth date", async () => {
    const wallet = await makeWallet({ daily: 200, monthly: 500 })
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(2026, 10, 15, 12))
    try {
      await db.tokenLog.createMany({ data: [
        { createdAt: new Date(2026, 9, 31, 12), costUsd: 100 },
        { createdAt: new Date(2026, 10, 14, 12), costUsd: 3.5 },
        { createdAt: new Date(2026, 10, 15, 9), costUsd: 1.25 },
      ].map((entry) => ({ agentId: wallet.agent.id, model, tokensIn: 1, tokensOut: 0, ...entry })) })
      expect(await reserve(wallet, 0.25)).toMatchObject({ exhausted: false, spent: 1.25, budget: 2 })
      expect(await reserve(wallet, 0.01)).toMatchObject({ exhausted: true, horizon: "monthly", spent: 5, budget: 5 })
      expect(await reserve(wallet, 0.51)).toMatchObject({ exhausted: true, horizon: "daily", spent: 1.5, budget: 2 })
    } finally {
      vi.useRealTimers()
    }
  })

  it("honors every nested pool without charging the parent for inner-pool denials", async () => {
    const root = await makeWallet({ pool: 500 })
    const inner = await makeWallet({ parentId: root.id, pool: 200 })
    const leaf = await makeWallet({ parentId: inner.id })
    const sibling = await makeWallet({ parentId: root.id })
    const innerResults = await settleAll(Array.from({ length: 6 }, () => reserve(leaf)))
    expect(innerResults.filter((r) => !r.exhausted)).toHaveLength(2)
    expect(innerResults.filter((r) => r.exhausted)).toEqual(Array.from({ length: 4 }, () =>
      expect.objectContaining({ horizon: "subtree-daily", capWalletId: inner.id })))
    const outerResults = await settleAll(Array.from({ length: 6 }, () => reserve(sibling)))
    expect(outerResults.filter((r) => !r.exhausted)).toHaveLength(3)
    expect(outerResults.filter((r) => r.exhausted)).toEqual(Array.from({ length: 3 }, () =>
      expect.objectContaining({ horizon: "subtree-daily", capWalletId: root.id })))
    expect(await reservations([root.id, inner.id, leaf.id, sibling.id])).toHaveLength(5)
  })

  it("settles concurrent retries into one TokenLog and refunds only the unused reservation", async () => {
    const wallet = await makeWallet({ daily: 100 })
    const id = await admitted(wallet)
    const usage = { ...dollarUsage, tokensIn: 250_000 }
    const costs = await settleAll(Array.from({ length: 10 }, () => resolveGatewayBudget(id, usage, true)))
    expect(costs).toEqual(Array(10).fill(0.25))
    expect(await logs([wallet.id])).toEqual([expect.objectContaining({
      gatewayReservationId: id, costUsd: 0.25, tokensIn: 250_000,
    })])
    expect(await reservations([wallet.id])).toEqual([expect.objectContaining({ status: "settled", observedUsd: 0.25 })])
    await admitted(wallet, 0.75)
    expect(await reserve(wallet, 0.01)).toMatchObject({ exhausted: true, horizon: "daily", spent: 1 })
    // A delayed release cannot erase confirmed spend.
    await releaseGatewayBudget(id)
    expect(await reserve(wallet, 0.01)).toMatchObject({ exhausted: true, spent: 1 })
    expect(await logs([wallet.id])).toHaveLength(1)
  })

  it("records actual usage above its estimate and blocks further admissions", async () => {
    const wallet = await makeWallet({ daily: 100 })
    const id = await admitted(wallet)
    expect(await resolveGatewayBudget(id, { ...dollarUsage, tokensIn: 2_000_000 }, true)).toBe(2)
    expect(await reservations([wallet.id])).toEqual([
      expect.objectContaining({ status: "settled", reservedUsd: 1, observedUsd: 2 }),
    ])
    expect(await logs([wallet.id])).toEqual([
      expect.objectContaining({ gatewayReservationId: id, costUsd: 2, tokensIn: 2_000_000 }),
    ])
    expect(await reserve(wallet, 0.000001)).toMatchObject({ exhausted: true, horizon: "daily", spent: 2, budget: 1 })
    expect((await logTokens(wallet, 0.000001)).status).toBe(402)
  })

  it("keeps settled spend in the reservation's original pool after a seat moves", async () => {
    const original = await makeWallet({ pool: 500 })
    const destination = await makeWallet({ pool: 500 })
    const originalSibling = await makeWallet({ parentId: original.id })
    const id = await admitted(original, 5)
    await db.agent.update({
      where: { id: original.agent.id, walletId: original.id },
      data: { walletId: destination.id },
    })
    await admitted(destination, 3)
    expect(await resolveGatewayBudget(id, { ...dollarUsage, tokensIn: 5_000_000 }, true)).toBe(5)
    expect(await reserve(originalSibling, 0.01)).toMatchObject({
      exhausted: true, horizon: "subtree-daily", spent: 5, capWalletId: original.id,
    })
    // The destination still has its original $2 of headroom: the old call was
    // funded by the original pool even though the seat now belongs here.
    await admitted(destination, 2)
    expect(await reserve(destination, 0.01)).toMatchObject({
      exhausted: true, horizon: "subtree-daily", spent: 5, capWalletId: destination.id,
    })
    expect(await db.gatewayReservation.findFirst({ where: { id, walletId: original.id } })).toMatchObject({
      status: "settled", observedUsd: 5,
    })
  })

  it("admits a moved seat through the gateway without charging its destination for an earlier settled call", async () => {
    const original = await makeWallet({ pool: 500 })
    const destination = await makeWallet({ pool: 500 })
    const originalSibling = await makeWallet({ parentId: original.id })
    const id = await admitted(original, 5)
    await resolveGatewayBudget(id, { ...dollarUsage, tokensIn: 5_000_000 }, true)
    await db.agent.update({
      where: { id: original.agent.id, walletId: original.id },
      data: { walletId: destination.id },
    })
    const fetchMock = vi.fn(async () => Response.json({
      model: gatewayBody.model, usage: { input_tokens: 1, output_tokens: 1 },
    }))
    vi.stubGlobal("fetch", fetchMock)

    // Authentication reloads the moved seat from PostgreSQL. Its new pool has
    // room even though the old settled TokenLog still belongs to the same seat.
    expect((await gatewayRequest(original)).status).toBe(200)
    const denied = await gatewayRequest(originalSibling)
    expect(denied.status).toBe(402)
    expect(await denied.json()).toMatchObject({ horizon: "subtree-daily", cap_wallet_id: original.id, spent_usd: 5 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await reservations([destination.id])).toEqual([
      expect.objectContaining({ agentId: original.agent.id, status: "settled", observedUsd: 0.000018 }),
    ])
    expect(await db.gatewayReservation.findFirst({ where: { id, walletId: original.id } })).toMatchObject({
      status: "settled", observedUsd: 5,
    })
  })

  it("keeps incomplete and missing usage charged until confirmed settlement", async () => {
    const parent = await makeWallet({ pool: 200 })
    const first = await makeWallet({ parentId: parent.id })
    const second = await makeWallet({ parentId: parent.id })
    const partial = await admitted(first)
    const missing = await admitted(second)
    await resolveGatewayBudget(partial, { ...dollarUsage, tokensIn: 250_000 }, false)
    await resolveGatewayBudget(missing, { model, tokensIn: 0, tokensOut: 0 }, false)
    await releaseGatewayBudget(partial)
    await releaseGatewayBudget(missing)
    expect(await reserve(first, 0.01)).toMatchObject({
      exhausted: true, horizon: "subtree-daily", spent: 2, capWalletId: parent.id,
    })
    expect(await reservations([first.id, second.id])).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: partial, status: "uncertain", observedUsd: 0.25 }),
      expect.objectContaining({ id: missing, status: "uncertain", observedUsd: 0 }),
    ]))
    await resolveGatewayBudget(partial, { ...dollarUsage, tokensIn: 500_000 }, true)
    await admitted(first, 0.5)
    expect(await reserve(second, 0.01)).toMatchObject({ exhausted: true, spent: 2 })
    const partialLogs = (await logs([first.id])).filter((row) => row.gatewayReservationId === partial)
    expect(partialLogs).toEqual([expect.objectContaining({ costUsd: 0.5, tokensIn: 500_000 })])
  })

  it("makes /tokens and gateway reservations contend for the same parent capacity", async () => {
    const parent = await makeWallet({ pool: 500 })
    const gateway = await makeWallet({ parentId: parent.id })
    const direct = await makeWallet({ parentId: parent.id })
    await admitted(gateway)
    expect((await logTokens(direct)).status).toBe(200)
    const outcomes = await settleAll(Array.from({ length: 8 }, async (_, i) => {
      if (i % 2 === 0) return !(await reserve(gateway)).exhausted
      const response = await logTokens(direct)
      expect([200, 402]).toContain(response.status)
      return response.status === 200
    }))
    expect(outcomes.filter(Boolean)).toHaveLength(3)
    expect(outcomes.filter((accepted) => !accepted)).toHaveLength(5)
    const held = (await reservations([gateway.id])).reduce((sum, row) => sum + row.reservedUsd, 0)
    const charged = (await logs([direct.id])).reduce((sum, row) => sum + row.costUsd, 0)
    expect(held + charged).toBe(5)
    expect((await logTokens(direct, 0.01)).status).toBe(402)
    expect(await reserve(gateway, 0.01)).toMatchObject({ exhausted: true, spent: 5 })
  })

  it("retains active holds across day and month rollover in seat and pool budgets", async () => {
    const parent = await makeWallet({ pool: 100 })
    const daily = await makeWallet({ parentId: parent.id, daily: 100 })
    const sibling = await makeWallet({ parentId: parent.id })
    const monthly = await makeWallet({ monthly: 100 })
    const ids = [await admitted(daily), await admitted(monthly)]
    const beforeLastMonth = new Date()
    beforeLastMonth.setMonth(beforeLastMonth.getMonth() - 2)
    await db.gatewayReservation.updateMany({
      where: { id: { in: ids }, walletId: { in: [daily.id, monthly.id] } },
      data: { createdAt: beforeLastMonth },
    })
    expect(await reserve(daily, 0.01)).toMatchObject({ exhausted: true, horizon: "daily", spent: 1 })
    expect(await reserve(sibling, 0.01)).toMatchObject({ exhausted: true, horizon: "subtree-daily", spent: 1 })
    expect(await reserve(monthly, 0.01)).toMatchObject({ exhausted: true, horizon: "monthly", spent: 1 })
    expect((await logTokens(sibling, 0.01)).status).toBe(402)
  })

  it.each(["settlement", "tokens"] as const)("dates %s spend after its budget lock crosses a period boundary", async (writer) => {
    const wallet = await makeWallet({ daily: 100, monthly: 100 })
    const id = writer === "settlement" ? await admitted(wallet) : undefined
    const lockKey = `token-budget:wallet:${wallet.id}`
    const blocker = new Client({ connectionString: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL })
    await blocker.connect()
    let writing: Observed<unknown> | undefined
    try {
      const { rows: [{ pid: blockerPid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      await blocker.query("BEGIN")
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1)::int8)", [lockKey])
      // Start the real transaction in this period, then hold it at its wallet
      // lock. PostgreSQL CURRENT_TIMESTAMP remains the transaction start even
      // when the budget operation resumes in a later accounting period.
      writing = observe<unknown>(writer === "settlement" ? resolveGatewayBudget(id!, dollarUsage, true) : logTokens(wallet))
      await waitUntil(async () => {
        const waiting = await advisoryWaiters(blocker, lockKey, blockerPid)
        expect(waiting.length).toBeLessThanOrEqual(1)
        return waiting.length === 1
      }, [writing])
      const before = new Date()
      const nextPeriod = new Date(before.getFullYear(), before.getMonth() + 1, 1, 1)
      // Fake only Date: sockets, PostgreSQL timeouts, and the lock barrier keep
      // using real timers. This advances the app's accounting boundary without
      // having to alter the disposable database server's wall clock.
      vi.useFakeTimers({ toFake: ["Date"] })
      vi.setSystemTime(nextPeriod)
      await blocker.query("COMMIT")
      const outcome = await writing.promise
      if (writer === "settlement") expect(outcome).toBe(1)
      else expect((outcome as Response).status).toBe(200)
      expect(await logs([wallet.id])).toEqual([
        expect.objectContaining({ createdAt: nextPeriod, costUsd: 1 }),
      ])
      expect(await reserve(wallet, 0.01)).toMatchObject({ exhausted: true, horizon: "daily", spent: 1 })
    } finally {
      await blocker.query("ROLLBACK").catch(() => {})
      await blocker.end()
      await Promise.allSettled(writing ? [writing.promise] : [])
      vi.useRealTimers()
    }
  }, 15_000)

  it("commits five holds before blocked provider fetches and denies five sibling requests", async () => {
    const perRequest = await gatewayReservationSize()
    const capCents = Math.ceil(perRequest * 5 * 100)
    expect(perRequest * 5).toBeLessThanOrEqual(capCents / 100)
    expect(perRequest * 6).toBeGreaterThan(capCents / 100)
    const parent = await makeWallet({ pool: capCents })
    const children = await settleAll([
      makeWallet({ parentId: parent.id }), makeWallet({ parentId: parent.id }),
    ])
    let unblock!: () => void
    const gate = new Promise<void>((resolve) => { unblock = resolve })
    let started = 0
    let returned = 0
    const fetchMock = vi.fn(async () => {
      started++
      await gate
      return Response.json({ model: gatewayBody.model, usage: { input_tokens: 1, output_tokens: 1 } })
    })
    vi.stubGlobal("fetch", fetchMock)
    const calls = Array.from({ length: 10 }, (_, i) => observe(gatewayRequest(children[i % 2]).then((response) => {
      returned++
      return response
    })))
    try {
      await waitUntil(async () => started + returned === 10, calls)
      expect(started).toBe(5)
      expect(returned).toBe(5)
      expect(fetchMock).toHaveBeenCalledTimes(5)
      const pending = await reservations(children.map((child) => child.id))
      expect(pending).toHaveLength(5)
      expect(pending.every((row) => row.status === "pending")).toBe(true)
      expect(pending.reduce((total, row) => total + row.reservedUsd, 0)).toBeCloseTo(perRequest * 5, 6)
      expect(await logs(children.map((child) => child.id))).toHaveLength(0)
    } finally {
      unblock()
      await Promise.allSettled(calls.map((call) => call.promise))
    }
    const results = await settleAll(calls.map((call) => call.promise))
    expect(results.filter((response) => response.status === 200)).toHaveLength(5)
    expect(results.filter((response) => response.status === 402)).toHaveLength(5)
    expect(await logs(children.map((child) => child.id))).toHaveLength(5)
    expect((await reservations(children.map((child) => child.id))).every((row) => row.status === "settled")).toBe(true)
  }, 15_000)

  it("retains the full committed hold after a provider network failure", async () => {
    const perRequest = await gatewayReservationSize()
    const wallet = await makeWallet({ daily: Math.ceil(perRequest * 100) })
    const fetchMock = vi.fn().mockRejectedValue(new Error("connection lost after request dispatch"))
    vi.stubGlobal("fetch", fetchMock)
    expect((await gatewayRequest(wallet)).status).toBe(502)
    expect((await gatewayRequest(wallet)).status).toBe(402)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await reservations([wallet.id])).toEqual([
      expect.objectContaining({ status: "pending", reservedUsd: perRequest, observedUsd: 0 }),
    ])
    expect(await logs([wallet.id])).toHaveLength(0)
  })

  it("retains unused capacity after cancellation of a partially metered provider stream", async () => {
    const perRequest = await gatewayReservationSize(true)
    const wallet = await makeWallet({ daily: Math.ceil(perRequest * 100) })
    const cancelled = vi.fn()
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
          type: "message_start",
          message: { model: gatewayBody.model, usage: { input_tokens: 1, output_tokens: 0 } },
        })}\n\n`))
      },
      cancel: cancelled,
    }), { headers: { "content-type": "text/event-stream" } }))
    vi.stubGlobal("fetch", fetchMock)
    const response = await gatewayRequest(wallet, true)
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    expect((await reader.read()).done).toBe(false)
    await reader.cancel("client disconnected")
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect((await gatewayRequest(wallet, true)).status).toBe(402)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await reservations([wallet.id])).toEqual([
      expect.objectContaining({ status: "uncertain", reservedUsd: perRequest, observedUsd: 0.000003 }),
    ])
    expect(await logs([wallet.id])).toEqual([
      expect.objectContaining({ costUsd: 0.000003, tokensIn: 1, tokensOut: 0 }),
    ])
  })

  it("admits a Claude tool loop with adaptive thinking and replayed reasoning, forwarding it unchanged", async () => {
    const wallet = await makeWallet({ daily: 100 })
    const loop = {
      model: gatewayBody.model, max_tokens: 4000, thinking: { type: "adaptive" }, output_config: { effort: "medium" },
      tools: [{ name: "lookup", input_schema: { type: "object", properties: { q: { type: "string" } } } }],
      messages: [
        { role: "user", content: "Find the report" },
        { role: "assistant", content: [
          { type: "thinking", thinking: "", signature: "c2lnbmVkLWZ1bGwtcmVhc29uaW5n".repeat(40) },
          { type: "tool_use", id: "call-1", name: "lookup", input: { q: "report" } },
        ] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "report.pdf" }] },
      ],
    }
    let forwarded: unknown
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      forwarded = JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer))
      return Response.json({ model: gatewayBody.model, usage: { input_tokens: 900, output_tokens: 120 } })
    }))
    const { POST } = await import("@/app/api/gateway/[provider]/[...path]/route")
    const response = await POST(new NextRequest("https://test.local/api/gateway/anthropic/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-sanction-key": wallet.key,
        "x-api-key": "test-provider-key", "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(loop),
    }), { params: Promise.resolve({ provider: "anthropic", path: ["v1", "messages"] }) })
    expect(response.status).toBe(200)
    expect(forwarded).toEqual(loop)
    expect(await reservations([wallet.id])).toEqual([expect.objectContaining({ status: "settled" })])
    expect(await logs([wallet.id])).toEqual([expect.objectContaining({ tokensIn: 900, tokensOut: 120 })])
  })

  it("never exposes a hold-to-spend gap and allows independent-wallet progress during settlement", async () => {
    const parent = await makeWallet({ pool: 100 })
    const first = await makeWallet({ parentId: parent.id })
    const sibling = await makeWallet({ parentId: parent.id })
    const independent = await makeWallet({ daily: 100 })
    const id = await admitted(first)
    const blocker = new Client({ connectionString: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL })
    await blocker.connect()
    let settling: Observed<number> | undefined
    let competing: Observed<Awaited<ReturnType<typeof reserve>>> | undefined
    try {
      const { rows: [{ pid: blockerPid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      await blocker.query("BEGIN")
      // Block only the durable spend insertion, after settlement has started.
      // Reads and reservation inserts remain available to independent wallets.
      await blocker.query('LOCK TABLE "TokenLog" IN SHARE MODE')
      settling = observe(resolveGatewayBudget(id, dollarUsage, true))
      const parentLockKey = `token-budget:wallet:${parent.id}`
      let settlementPid: number | undefined
      await waitUntil(async () => {
        // Identify our settlement backend by the unique parent lock it holds,
        // its blocked TokenLog write, and this connection actually blocking it.
        const { rows } = await blocker.query<{ pid: number }>(`SELECT waiting.pid
          FROM pg_locks waiting JOIN pg_locks parent ON parent.pid = waiting.pid
          WHERE waiting.database = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND waiting.relation = '"TokenLog"'::regclass
            AND waiting.mode = 'RowExclusiveLock' AND NOT waiting.granted
            AND parent.locktype = 'advisory' AND parent.granted
            AND parent.classid::bigint = CASE WHEN hashtext($1) < 0 THEN 4294967295 ELSE 0 END
            AND parent.objid::bigint = (hashtext($1)::bigint & 4294967295) AND parent.objsubid = 1
            AND $2::int = ANY(pg_blocking_pids(waiting.pid))`, [parentLockKey, blockerPid])
        expect(rows.length).toBeLessThanOrEqual(1)
        settlementPid = rows[0]?.pid
        return settlementPid !== undefined
      }, [settling])
      competing = observe(reserve(sibling))
      let siblingPid: number | undefined
      await waitUntil(async () => {
        const waiting = await advisoryWaiters(blocker, parentLockKey, settlementPid!)
        expect(waiting.length).toBeLessThanOrEqual(1)
        siblingPid = waiting[0]
        return siblingPid !== undefined
      }, [settling, competing])
      await admitted(independent)
      // Independent progress happens while the sibling is demonstrably waiting
      // on this settlement's parent lock, not merely while its promise is idle.
      expect(await advisoryWaiters(blocker, parentLockKey, settlementPid!)).toEqual([siblingPid])
      expect(await reservations([first.id])).toEqual([expect.objectContaining({ id, status: "pending" })])
      expect(await logs([first.id])).toHaveLength(0)
      await blocker.query("COMMIT")
      expect(await settling.promise).toBe(1)
      expect(await competing.promise).toMatchObject({ exhausted: true, spent: 1, capWalletId: parent.id })
      expect(await logs([first.id])).toEqual([expect.objectContaining({ gatewayReservationId: id, costUsd: 1 })])
    } finally {
      await blocker.query("ROLLBACK").catch(() => {})
      await blocker.end()
      await Promise.allSettled([settling?.promise, competing?.promise].filter((promise) => promise !== undefined))
    }
  }, 15_000)
})
