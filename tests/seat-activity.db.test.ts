import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "@/lib/db"
import { readSeatActivity } from "@/lib/seatActivity"

function log(model: string, taskLabel: string | null, createdAt: Date, id: string = randomUUID()) {
  return { id, model, taskLabel, createdAt, tokensIn: 1, tokensOut: 1, costUsd: 0 }
}

function seat(id: string, logs: ReturnType<typeof log>[] = []) {
  return {
    id, name: "test seat", apiKeyHash: randomUUID(), apiKeyPrefix: "pxy_test",
    tokenLogs: { create: logs },
  }
}

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("seat activity (Postgres)", () => {
  const walletId = randomUUID()
  const otherWalletId = randomUUID()
  const active = randomUUID()
  const idle = randomUUID()
  const other = randomUUID()
  const latest = new Date()
  const historical = new Date(latest.getTime() - 400 * 86_400_000)
  const tieId = randomUUID()

  beforeAll(async () => {
    await db.wallet.create({ data: {
      id: walletId, name: "seat activity test", ownerEmail: `${walletId}@example.test`,
      agents: { create: [
        seat(active, [
          log("model-b", "current task", latest),
          log("model-a", "previous task", historical),
          log("model-a", null, historical),
        ]),
        seat(idle),
      ] },
    } })
    await db.wallet.create({ data: {
      id: otherWalletId, name: "other wallet", ownerEmail: `${otherWalletId}@example.test`,
      agents: { create: seat(other, [
        log("model-z", null, latest, `${tieId}-2`),
        log("model-a", "same timestamp", latest, `${tieId}-1`),
      ]) },
    } })
  })

  afterAll(async () => {
    const walletIds = [walletId, otherWalletId]
    await db.$transaction([
      db.tokenLog.deleteMany({ where: { agent: { walletId: { in: walletIds } } } }),
      db.agent.deleteMany({ where: { walletId: { in: walletIds } } }),
      db.wallet.deleteMany({ where: { id: { in: walletIds } } }),
    ])
  })

  it("counts lifetime model use independently of the latest task and excludes foreign seats", async () => {
    expect(await readSeatActivity([walletId], [active, idle, other])).toEqual([
      { agentId: active, totalCalls: 3, topModel: "model-a", lastTask: "current task", lastSeen: latest },
    ])
  })

  it("honors the requested seats across wallets and breaks model and timestamp ties", async () => {
    expect(await readSeatActivity([walletId, otherWalletId], [other])).toEqual([
      { agentId: other, totalCalls: 2, topModel: "model-a", lastTask: null, lastSeen: latest },
    ])
  })

  it("keeps call counts and latest tasks separate when both active seats are requested", async () => {
    const rows = await readSeatActivity([walletId, otherWalletId], [active, other])
    expect(rows).toHaveLength(2)
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: active, totalCalls: 3, lastTask: "current task" }),
      expect.objectContaining({ agentId: other, totalCalls: 2, lastTask: null }),
    ]))
  })

  it("returns no rows for an idle seat or either empty scope", async () => {
    expect(await readSeatActivity([walletId], [idle])).toEqual([])
    expect(await readSeatActivity([], [active])).toEqual([])
    expect(await readSeatActivity([walletId], [])).toEqual([])
  })
})
