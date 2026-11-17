import { randomUUID } from "node:crypto"
import { PrismaPg } from "@prisma/adapter-pg"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { PrismaClient, type Prisma } from "@/lib/generated/prisma/client"
import { db } from "@/lib/db"
import {
  CLEANUP_BATCH_SIZE, EXECUTION_TOKEN_RETENTION_MS, TRANSIENT_RETENTION_MS, cleanupExpiredRecords,
} from "@/lib/cleanup"
import { rateLimit } from "@/lib/rateLimit"
import { withTenant } from "@/lib/rls"

// test:db runs this file after the other DB suites: Better Auth's real login
// adapter also deletes expired verification rows and would race these counts.
// A historical cutoff prevents cleanup from consuming any current fixtures.
const now = new Date("2001-06-01T00:00:00.000Z")
const executionCutoff = new Date(now.getTime() - EXECUTION_TOKEN_RETENTION_MS)
const transientCutoff = new Date(now.getTime() - TRANSIENT_RETENTION_MS)
const oldExecution = new Date(executionCutoff.getTime() - 1)
const oldTransient = new Date(transientCutoff.getTime() - 1)
const tableNames = ["executionTokens", "magicLinks", "verifications", "rateLimits"]

describe.skipIf(process.env.RUN_DB_TESTS !== "1")("expired record cleanup (Postgres)", () => {
  let admin: PrismaClient
  const walletIds = [randomUUID(), randomUUID()]
  const agentIds = [randomUUID(), randomUUID()]
  const credentialIds = [randomUUID(), randomUUID()]
  const verificationIds: string[] = []
  const rateKeys: string[] = []

  beforeAll(async () => {
    admin = new PrismaClient({ adapter: new PrismaPg({
      connectionString: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL!,
    }) })
    const [role] = await db.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false })
    for (const [i, id] of walletIds.entries()) {
      await admin.wallet.create({ data: {
        id, name: "cleanup test", ownerEmail: `${id}@example.test`,
        agents: { create: {
          id: agentIds[i], name: "cleanup seat", apiKeyHash: randomUUID(), apiKeyPrefix: "pxy_test",
        } },
        credentials: { create: {
          id: credentialIds[i], label: "test", type: "api_key", encryptedValue: "fixture",
        } },
      } })
    }
  })

  afterEach(async () => {
    await admin.$transaction([
      admin.credentialInjection.deleteMany({ where: { executionToken: { walletId: { in: walletIds } } } }),
      admin.executionToken.deleteMany({ where: { walletId: { in: walletIds } } }),
      admin.magicLink.deleteMany({ where: { walletId: { in: walletIds } } }),
      admin.verification.deleteMany({ where: { id: { in: verificationIds } } }),
      admin.rateLimit.deleteMany({ where: { key: { in: rateKeys } } }),
    ])
    verificationIds.length = 0
    rateKeys.length = 0
  })

  afterAll(async () => {
    await admin.$transaction([
      admin.credentialVault.deleteMany({ where: { walletId: { in: walletIds } } }),
      admin.agent.deleteMany({ where: { walletId: { in: walletIds } } }),
      admin.wallet.deleteMany({ where: { id: { in: walletIds } } }),
    ])
    await admin.$disconnect()
  })

  function execution(overrides: Partial<Prisma.ExecutionTokenCreateManyInput> = {}) {
    return {
      id: randomUUID(), walletId: walletIds[0], agentId: agentIds[0], scope: ["test"],
      budgetUsd: 10, spentUsd: 0, issuedAt: new Date("2001-01-01T00:00:00Z"),
      expiresAt: oldExecution, ...overrides,
    }
  }

  function transient(expiresAt = oldTransient, walletId = walletIds[0]) {
    const id = randomUUID()
    verificationIds.push(id)
    rateKeys.push(id)
    return {
      magicLink: { id, walletId, email: `${walletId}@example.test`, tokenHash: randomUUID(), expiresAt },
      verification: { id, identifier: `magic-link-${id}`, value: "fixture", expiresAt },
      rateLimit: { key: id, count: 5, windowEnd: expiresAt },
    }
  }

  async function seedTransient(rows: ReturnType<typeof transient>[]) {
    await admin.$transaction([
      admin.magicLink.createMany({ data: rows.map(row => row.magicLink) }),
      admin.verification.createMany({ data: rows.map(row => row.verification) }),
      admin.rateLimit.createMany({ data: rows.map(row => row.rateLimit) }),
    ])
  }

  it("applies strict cutoffs across wallets and removes expired tokens regardless of stored status", async () => {
    const expired = ["active", "expired", "revoked", "completed"].map(status => execution({ status }))
    expired.push(execution({ walletId: walletIds[1], agentId: agentIds[1] }))
    const retained = [executionCutoff, new Date(executionCutoff.getTime() + 1), new Date("2035-01-01")].map(
      expiresAt => execution({ expiresAt }),
    )
    await admin.executionToken.createMany({ data: [...expired, ...retained] })
    const removed = [transient(), transient(oldTransient, walletIds[1])]
    const live = [transient(transientCutoff), transient(new Date(transientCutoff.getTime() + 1)), transient(new Date("2035-01-01"))]
    await seedTransient([...removed, ...live])
    await admin.magicLink.update({ where: { id: removed[1].magicLink.id }, data: { usedAt: new Date("2001-01-01") } })

    expect(await cleanupExpiredRecords(now)).toEqual({
      deleted: { executionTokens: 5, magicLinks: 2, verifications: 2, rateLimits: 2 },
      batchFull: [], failed: [], retainedExecutionTokens: 0,
    })
    expect((await admin.executionToken.findMany({ where: { walletId: { in: walletIds } } })).map(row => row.id).sort())
      .toEqual(retained.map(row => row.id).sort())
    expect((await admin.magicLink.findMany({ where: { walletId: { in: walletIds } } })).map(row => row.id).sort())
      .toEqual(live.map(row => row.magicLink.id).sort())
    expect((await admin.verification.findMany({ where: { id: { in: verificationIds } } })).map(row => row.id).sort())
      .toEqual(live.map(row => row.verification.id).sort())
    expect((await admin.rateLimit.findMany({ where: { key: { in: rateKeys } } })).map(row => row.key).sort())
      .toEqual(live.map(row => row.rateLimit.key).sort())
  })

  it("retains spent tokens and credential-injection audit references", async () => {
    const unused = execution()
    const spent = execution({ spentUsd: 0.01 })
    const referenced = execution()
    await admin.executionToken.createMany({ data: [unused, spent, referenced] })
    const audit = await admin.credentialInjection.create({ data: {
      executionTokenId: referenced.id, credentialId: credentialIds[0],
    } })
    const result = await cleanupExpiredRecords(now)
    expect(result.deleted.executionTokens).toBe(1)
    expect(result.failed).toEqual([])
    expect(result.retainedExecutionTokens).toBe(0)
    expect(await admin.executionToken.findUnique({ where: { id: unused.id } })).toBeNull()
    expect(await admin.executionToken.findUnique({ where: { id: spent.id } })).toMatchObject({ spentUsd: 0.01 })
    expect(await admin.executionToken.findUnique({ where: { id: referenced.id } })).not.toBeNull()
    expect(await admin.credentialInjection.findUnique({ where: { id: audit.id } })).toEqual(audit)
  })

  it("bounds overlapping runs and reports full batches until the backlog drains", async () => {
    const count = 2 * CLEANUP_BATCH_SIZE + 1
    await admin.executionToken.createMany({ data: Array.from({ length: count }, () => execution()) })
    await seedTransient(Array.from({ length: count }, () => transient()))
    const settled = await Promise.allSettled([cleanupExpiredRecords(now), cleanupExpiredRecords(now)])
    expect(settled.filter(result => result.status === "rejected")).toEqual([])
    for (const result of settled) {
      if (result.status !== "fulfilled") continue
      expect(result.value.failed).toEqual([])
      expect(result.value.retainedExecutionTokens).toBe(0)
      expect(Object.values(result.value.deleted)).toEqual(Array(4).fill(CLEANUP_BATCH_SIZE))
      expect([...result.value.batchFull].sort()).toEqual([...tableNames].sort())
    }
    expect(await cleanupExpiredRecords(now)).toEqual({
      deleted: { executionTokens: 1, magicLinks: 1, verifications: 1, rateLimits: 1 },
      batchFull: [], failed: [], retainedExecutionTokens: 0,
    })
    expect(await cleanupExpiredRecords(now)).toEqual({
      deleted: { executionTokens: 0, magicLinks: 0, verifications: 0, rateLimits: 0 },
      batchFull: [], failed: [], retainedExecutionTokens: 0,
    })
  }, 20_000)

  it("skips a locked stale rate counter and retains its subsequently renewed window", async () => {
    const bucket = `cleanup-${randomUUID()}`
    const ip = "192.0.2.10"
    const key = `${bucket}:${ip}`
    rateKeys.push(key)
    await admin.rateLimit.create({ data: { key, count: 99, windowEnd: oldTransient } })
    let markLocked!: () => void
    let releaseLock!: () => void
    const locked = new Promise<void>(resolve => { markLocked = resolve })
    const release = new Promise<void>(resolve => { releaseLock = resolve })
    const locker = admin.$transaction(async tx => {
      await tx.$queryRaw`SELECT "key" FROM "RateLimit" WHERE "key" = ${key} FOR UPDATE`
      markLocked()
      await release
    }, { timeout: 10_000 })
    await Promise.race([locked, locker])
    const renewed = rateLimit(bucket, ip, 10, 60)
    try {
      expect((await cleanupExpiredRecords(now)).deleted.rateLimits).toBe(0)
    } finally {
      releaseLock()
      await locker
      await renewed
    }
    expect((await cleanupExpiredRecords(now)).deleted.rateLimits).toBe(0)
    expect(await admin.rateLimit.findUnique({ where: { key } })).toMatchObject({ count: 1 })
  }, 15_000)

  it("retains an RLS-hidden audit reference and deletes unrelated tokens across repeated runs", async () => {
    const token = execution()
    const clean = execution()
    await admin.executionToken.createMany({ data: [token, clean] })
    const audit = await admin.credentialInjection.create({ data: {
      executionTokenId: token.id, credentialId: credentialIds[1],
    } })
    expect(await withTenant(walletIds, tx => tx.credentialInjection.findUnique({ where: { id: audit.id } }))).toBeNull()
    await seedTransient([transient()])
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(await cleanupExpiredRecords(now)).toEqual({
        deleted: { executionTokens: 1, magicLinks: 1, verifications: 1, rateLimits: 1 },
        batchFull: [], failed: [], retainedExecutionTokens: 1,
      })
      expect(await cleanupExpiredRecords(now)).toEqual({
        deleted: { executionTokens: 0, magicLinks: 0, verifications: 0, rateLimits: 0 },
        batchFull: [], failed: [], retainedExecutionTokens: 1,
      })
    } finally {
      logged.mockRestore()
    }
    expect(await admin.executionToken.findUnique({ where: { id: clean.id } })).toBeNull()
    expect(await admin.executionToken.findUnique({ where: { id: token.id } })).not.toBeNull()
    expect(await admin.credentialInjection.findUnique({ where: { id: audit.id } })).toEqual(audit)
  })
})
