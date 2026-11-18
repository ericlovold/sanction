import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"
import { PrismaPg } from "@prisma/adapter-pg"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { PrismaClient } from "@/lib/generated/prisma/client"
import { generateApiKey } from "@/lib/apiKey"
import { gatewayLatencyProxy } from "./helpers/gatewayLatencyProxy"

vi.mock("next/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/server")>()
  return { ...original, after: () => {} }
})
vi.mock("@/lib/thresholds", () => ({ notifyTokenBudgetThreshold: vi.fn() }))

// Real route handlers, default lib/db factory and PostgreSQL transactions.
// Only provider IO and notification delivery are stubbed. A TCP proxy adds
// bounded network latency; no transaction/query deadline is extended.
// Requires RUN_DB_TESTS=1 and a disposable LOCAL PostgreSQL database.
const run = process.env.RUN_DB_TESTS === "1"
const created: string[] = []
const model = "claude-opus-4-6"
type GatewayDb = typeof import("@/lib/db").db
const cache = globalThis as unknown as { prisma?: GatewayDb }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function bounded(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Gateway admission barrier did not complete")), 20_000)
    })])
  } finally {
    clearTimeout(timer)
  }
}

describe.skipIf(!run)("gateway contention with default database deadlines (Postgres)", () => {
  let fixtureDb: PrismaClient
  let gatewayDb: GatewayDb
  let originalTransaction: GatewayDb["$transaction"]
  let proxy: Awaited<ReturnType<typeof gatewayLatencyProxy>>
  let sourceUrl: string | undefined
  let previousClient: GatewayDb | undefined
  let post: typeof import("@/app/api/gateway/[provider]/[...path]/route").POST
  let requestBody: string

  beforeAll(async () => {
    sourceUrl = process.env.DATABASE_URL
    if (!sourceUrl) throw new Error("Missing disposable local DATABASE_URL")
    // The proxy validates loopback before either client opens a connection.
    proxy = await gatewayLatencyProxy(sourceUrl)
    fixtureDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: sourceUrl }) })
    previousClient = cache.prisma
    delete cache.prisma
    vi.resetModules()
    process.env.DATABASE_URL = proxy.connectionString
    gatewayDb = (await import("@/lib/db")).db
    originalTransaction = gatewayDb.$transaction
    post = (await import("@/app/api/gateway/[provider]/[...path]/route")).POST
    const { prepareGatewayRequest } = await import("@/lib/gatewayRequestBudget")
    const body = { model, max_tokens: 39_000, messages: [{ role: "user", content: "" }] }
    const estimate = () => prepareGatewayRequest("anthropic", "v1/messages", new TextEncoder().encode(JSON.stringify(body)).buffer).reservedUsd
    // Opus input at the estimator's 1-hour cache-write rate adds $0.000010 per
    // ASCII byte. Select the prompt size using the real estimator, then assert
    // the exact $1 reservation instead of mocking its budget input.
    body.messages[0].content = "a".repeat(Math.round((1 - estimate()) / 0.000010))
    expect(estimate()).toBe(1)
    requestBody = JSON.stringify(body)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (gatewayDb) gatewayDb.$transaction = originalTransaction
    if (!fixtureDb || !created.length) return
    const scope = { in: created }
    await fixtureDb.tokenLog.deleteMany({ where: { agent: { walletId: scope } } })
    await fixtureDb.gatewayReservation.deleteMany({ where: { walletId: scope } })
    await fixtureDb.authorizationRequest.deleteMany({ where: { agent: { walletId: scope } } })
    await fixtureDb.agent.deleteMany({ where: { walletId: scope } })
    await fixtureDb.policy.deleteMany({ where: { walletId: scope } })
    for (const id of [...created].reverse()) await fixtureDb.wallet.delete({ where: { id } })
    created.length = 0
  })

  afterAll(async () => {
    await gatewayDb?.$disconnect()
    await fixtureDb?.$disconnect()
    await proxy?.close()
    if (sourceUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = sourceUrl
    if (previousClient === undefined) delete cache.prisma
    else cache.prisma = previousClient
  })

  async function wallet(parentId?: string) {
    const key = generateApiKey()
    const id = randomUUID()
    const result = await fixtureDb.wallet.create({ data: {
      id, parentId, name: "gateway contention proof", ownerEmail: `${id}@example.test`,
      policy: { create: { dailyTokenBudgetUsd: 100_000, ...(!parentId ? { subtreeDailyTokenCapUsd: 500 } : {}) } },
      agents: { create: { name: "contention seat", apiKeyHash: key.hash, apiKeyPrefix: key.prefix } },
    }, include: { agents: true } })
    created.push(id)
    return { id, agentId: result.agents[0].id, key: key.raw }
  }

  it.each([0, 100])("admits five, denies five, and settles without 503 at %i ms database RTT", async (roundTripMs) => {
    const defaults = (gatewayDb as unknown as { _engineConfig: { transactionOptions: { timeout: number; maxWait: number } } })._engineConfig.transactionOptions
    expect(defaults).toMatchObject({ timeout: 5000, maxWait: 2000 })
    const parent = await wallet()
    const siblings = [await wallet(parent.id), await wallet(parent.id)]
    const walletIds = siblings.map((sibling) => sibling.id)
    const gate = deferred()
    const arrivals = deferred()
    const entered = new Set<number>()
    const settledResponses: Response[] = []
    const backgroundErrors: unknown[] = []
    const transactionErrors: { code: string; timeout: boolean }[] = []
    const transactionMs: number[] = []
    const transactionOptions: Record<string, unknown>[] = []
    let arrivalsCount = 0
    const arrived = () => { if (++arrivalsCount === 10) arrivals.resolve() }
    const realTransaction = originalTransaction.bind(gatewayDb)
    // Transparent instrumentation only: forward every callback and option
    // unchanged, recording the real Prisma error code and elapsed duration.
    const measuredTransaction = ((...args: unknown[]) => {
      transactionOptions.push((args[1] ?? {}) as Record<string, unknown>)
      const start = performance.now()
      return Reflect.apply(realTransaction, gatewayDb, args).then((value: unknown) => {
        transactionMs.push(performance.now() - start)
        return value
      }, (error: unknown) => {
        transactionMs.push(performance.now() - start)
        const detail = error as { code?: string; message?: string }
        transactionErrors.push({ code: detail.code ?? "unknown", timeout: /expired|timeout|timed out/i.test(detail.message ?? "") })
        throw error
      })
    }) as typeof gatewayDb.$transaction
    gatewayDb.$transaction = measuredTransaction
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const index = Number(new Headers(init.headers).get("x-contention-index"))
      expect(Number.isInteger(index) && index >= 0 && index < 10).toBe(true)
      entered.add(index)
      arrived()
      await gate.promise
      // First three admitted requests settle a full dollar. Remaining two
      // receive a definitive provider auth rejection and release their holds.
      return [...entered].indexOf(index) < 3
        ? Response.json({ model, usage: { input_tokens: 200_000, output_tokens: 0 } })
        : Response.json({ error: { type: "authentication_error" } }, { status: 401 })
    })
    vi.stubGlobal("fetch", fetchMock)
    proxy.setRoundTripMs(roundTripMs)
    proxy.resetMetrics()
    const start = performance.now()
    const calls = Array.from({ length: 10 }, (_, index) => post(new NextRequest("https://test.local/api/gateway/anthropic/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-sanction-key": siblings[index % 2].key,
        "x-api-key": "invalid-provider-key-for-local-test", "x-contention-index": String(index),
      },
      body: requestBody,
    }), { params: Promise.resolve({ provider: "anthropic", path: ["v1", "messages"] }) }).then((response) => {
      settledResponses.push(response)
      if (!entered.has(index)) arrived()
      return response
    }, (error: unknown) => {
      backgroundErrors.push(error)
      if (!entered.has(index)) arrived()
      throw error
    }))
    // Observe every rejection immediately and drain every request before cleanup.
    const completed = Promise.allSettled(calls)
    let admissionMs: number | undefined
    let admissionQueries: number | undefined
    try {
      await bounded(arrivals.promise)
      admissionMs = performance.now() - start
      admissionQueries = proxy.metrics().queries
      if (backgroundErrors.length) throw backgroundErrors[0]
      expect(transactionErrors, "Real Prisma transaction failures").toEqual([])
      expect(entered.size).toBe(5)
      expect(fetchMock).toHaveBeenCalledTimes(5)
      expect(settledResponses.map((response) => response.status)).toEqual(Array(5).fill(402))
      const pending = await fixtureDb.gatewayReservation.findMany({ where: { walletId: { in: walletIds } } })
      expect(pending).toHaveLength(5)
      expect(pending.every((row) => row.status === "pending" && row.reservedUsd === 1)).toBe(true)
      expect(await fixtureDb.tokenLog.count({ where: { agent: { walletId: { in: walletIds } } } })).toBe(0)
      const bodies = await Promise.all(settledResponses.map((response) => response.clone().json()))
      const receipts = await fixtureDb.authorizationRequest.findMany({ where: { agent: { walletId: { in: walletIds } } } })
      expect(receipts).toHaveLength(5)
      expect(receipts.map((row) => row.id).sort()).toEqual(bodies.map((body) => body.request_id).sort())
      expect(receipts).toEqual(Array.from({ length: 5 }, () => expect.objectContaining({
        status: "denied", amountUsd: 0, decidedAt: expect.any(Date),
        detailsJson: expect.objectContaining({ provider: "anthropic", model, horizon: "subtree-daily", cap_wallet_id: parent.id, occupied_usd: 5 }),
      })))
      expect(await fixtureDb.pendingApproval.count({ where: { walletId: { in: walletIds } } })).toBe(0)
    } finally {
      gate.resolve()
      await completed
      console.info("gateway contention diagnostics", JSON.stringify({
        roundTripMs, admissionMs: admissionMs && Math.round(admissionMs), totalMs: Math.round(performance.now() - start),
        admissionQueries, totalQueries: proxy.metrics().queries, byVerb: proxy.metrics().byVerb,
        providerCalls: entered.size, statuses: settledResponses.map((response) => response.status).sort(),
        transactionErrors, longestTransactionMs: Math.round(Math.max(0, ...transactionMs)),
      }))
    }
    const outcomes = await completed
    for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason
    expect(transactionErrors).toEqual([])
    expect(transactionOptions.every((options) => options.timeout === undefined && options.maxWait === undefined)).toBe(true)
    expect(settledResponses.map((response) => response.status).sort()).toEqual([200, 200, 200, 401, 401, 402, 402, 402, 402, 402])
    const resolved = await fixtureDb.gatewayReservation.findMany({ where: { walletId: { in: walletIds } } })
    expect(resolved.filter((row) => row.status === "settled" && row.observedUsd === 1)).toHaveLength(3)
    expect(resolved.filter((row) => row.status === "released" && row.observedUsd === 0)).toHaveLength(2)
    const logs = await fixtureDb.tokenLog.findMany({ where: { agent: { walletId: { in: walletIds } } } })
    expect(logs).toHaveLength(3)
    expect(new Set(logs.map((row) => row.gatewayReservationId)).size).toBe(3)
    expect(logs.reduce((sum, row) => sum + row.costUsd, 0)).toBe(3)
  }, 45_000) // Test-runner guard only; Prisma still uses 5 s / 2 s defaults.
})
