import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { appRoleUrl } from "./setup/db-app-role"
import { encryptCredential } from "../lib/jwt"
import { generateApiKey } from "../lib/apiKey"
import { randomUUID } from "node:crypto"

// SEC-3 RLS proof. Postgres bypasses RLS for superusers, so this MUST run as a
// non-superuser role to be meaningful (production's app role is non-superuser).
// We seed as the owner (DATABASE_ADMIN_URL), then exercise each RLS-protected table
// as the restricted role `sanction_app` (tests/setup/db-app-role.ts) to prove the policy
// confines it. One describe block per RLS-enabled table; the Phase-2 loop appends.
//
//   RUN_DB_TESTS=1 DATABASE_URL="postgres://…disposable…" npx vitest run tests/rls.db.test.ts
const run = process.env.RUN_DB_TESTS === "1"

describe.skipIf(!run)("SEC-3: RLS confines tenant tables to their wallet", () => {
  let appClient: PrismaClient
  let db: PrismaClient
  let adminUrl = ""
  let walletA = ""
  let walletB = ""
  let agentA = ""
  let agentB = ""
  let credBId = ""
  let tokenA = ""
  let tokenB = ""
  let injectionB = ""

  beforeAll(async () => {
    // Owner connection for seeding; sanction_app is provisioned by the global setup.
    adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL!
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) })
    const ts = Date.now()
    const wa = await db.wallet.create({ data: { name: "A", ownerEmail: `a-${ts}@e.com` } })
    const wb = await db.wallet.create({ data: { name: "B", ownerEmail: `b-${ts}@e.com` } })
    walletA = wa.id
    walletB = wb.id

    const ka = generateApiKey()
    const kb = generateApiKey()
    const aa = await db.agent.create({ data: { walletId: walletA, name: "aa", apiKeyHash: ka.hash, apiKeyPrefix: ka.prefix } })
    const ab = await db.agent.create({ data: { walletId: walletB, name: "ab", apiKeyHash: kb.hash, apiKeyPrefix: kb.prefix } })
    agentA = aa.id
    agentB = ab.id

    const ca = await db.credentialVault.create({
      data: { walletId: walletA, label: "k", type: "api_key", encryptedValue: encryptCredential("secretA", walletA, "k") },
    })
    const cb = await db.credentialVault.create({
      data: { walletId: walletB, label: "k", type: "api_key", encryptedValue: encryptCredential("secretB", walletB, "k") },
    })
    credBId = cb.id

    tokenA = randomUUID()
    tokenB = randomUUID()
    for (const [id, walletId, agentId, credentialId] of [
      [tokenA, walletA, agentA, ca.id],
      [tokenB, walletB, agentB, cb.id],
    ]) {
      await db.executionToken.create({ data: { id, walletId, agentId, scope: ["k"], budgetUsd: 10, expiresAt: new Date(Date.now() + 60_000) } })
      const injection = await db.credentialInjection.create({ data: { executionTokenId: id, credentialId } })
      if (id === tokenB) injectionB = injection.id
    }

    await db.agentClearance.create({ data: { walletId: walletA, agentId: agentA, level: 3 } })
    await db.agentClearance.create({ data: { walletId: walletB, agentId: agentB, level: 5 } })

    await db.slackInstall.create({
      data: { walletId: walletA, teamId: "TA", channelId: "CA1", botTokenEnc: "encA" },
    })
    await db.slackInstall.create({
      data: { walletId: walletB, teamId: "TB", channelId: "CB1", botTokenEnc: "encB" },
    })

    appClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: appRoleUrl(adminUrl) }) })
  })

  afterAll(async () => {
    await appClient?.$disconnect()
    if (walletA) {
      await db.credentialInjection.deleteMany({ where: { executionToken: { walletId: { in: [walletA, walletB] } } } })
      await db.executionToken.deleteMany({ where: { walletId: { in: [walletA, walletB] } } })
      await db.agentClearance.deleteMany({ where: { walletId: { in: [walletA, walletB] } } })
      await db.slackInstall.deleteMany({ where: { walletId: { in: [walletA, walletB] } } })
      await db.credentialVault.deleteMany({ where: { walletId: { in: [walletA, walletB] } } })
      await db.agent.deleteMany({ where: { walletId: { in: [walletA, walletB] } } })
      await db.wallet.deleteMany({ where: { id: { in: [walletA, walletB] } } })
    }
    await db?.$disconnect()
  })

  // Mirror lib/rls.ts withTenant() against the non-superuser client.
  function asTenant<T>(wallet: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return appClient.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.wallet_ids', ${wallet}, true)`
      return fn(tx as unknown as PrismaClient)
    })
  }

  describe("CredentialVault", () => {
    it("A sees only its own credential — even with NO where clause", async () => {
      const rows = await asTenant(walletA, (tx) => tx.credentialVault.findMany({}))
      expect(rows).toHaveLength(1)
      expect(rows[0].walletId).toBe(walletA)
    })
    it("A cannot read B's credential by id", async () => {
      expect(await asTenant(walletA, (tx) => tx.credentialVault.findFirst({ where: { id: credBId } }))).toBeNull()
    })
    it("A cannot write into B's vault (WITH CHECK blocks it)", async () => {
      await expect(
        asTenant(walletA, (tx) =>
          tx.credentialVault.create({ data: { walletId: walletB, label: "x", type: "api_key", encryptedValue: "x" } }),
        ),
      ).rejects.toThrow()
    })
    it("no tenant context → vault invisible (fail-closed)", async () => {
      expect(await appClient.credentialVault.findMany({})).toHaveLength(0)
    })
  })

  describe("AgentClearance", () => {
    it("A sees only its own clearance — even with NO where clause", async () => {
      const rows = await asTenant(walletA, (tx) => tx.agentClearance.findMany({}))
      expect(rows).toHaveLength(1)
      expect(rows[0].walletId).toBe(walletA)
    })
    it("A cannot read B's clearance by agentId", async () => {
      expect(await asTenant(walletA, (tx) => tx.agentClearance.findUnique({ where: { agentId: agentB } }))).toBeNull()
    })
    it("no tenant context → clearance invisible (fail-closed)", async () => {
      expect(await appClient.agentClearance.findMany({})).toHaveLength(0)
    })
  })

  describe("SlackInstall", () => {
    it("A sees only its own install — even with NO where clause", async () => {
      const rows = await asTenant(walletA, (tx) => tx.slackInstall.findMany({}))
      expect(rows).toHaveLength(1)
      expect(rows[0].walletId).toBe(walletA)
    })
    it("A cannot write into B's SlackInstall (WITH CHECK blocks it)", async () => {
      await expect(
        asTenant(walletA, (tx) =>
          tx.slackInstall.create({ data: { walletId: walletB, teamId: "TX", channelId: "CX1", botTokenEnc: "x" } }),
        ),
      ).rejects.toThrow()
    })
    it("no tenant context → install invisible (fail-closed)", async () => {
      expect(await appClient.slackInstall.findMany({})).toHaveLength(0)
    })
  })

  describe("ExecutionToken and CredentialInjection", () => {
    it("restricts unfiltered reads and required relation joins to the scoped wallet", async () => {
      const tokens = await asTenant(walletA, (tx) => tx.executionToken.findMany())
      expect(tokens.map((row) => row.id)).toEqual([tokenA])
      const injections = await asTenant(walletA, (tx) => tx.credentialInjection.findMany({
        include: { executionToken: true, credential: true },
      }))
      expect(injections).toHaveLength(1)
      expect(injections[0].executionToken.walletId).toBe(walletA)
      expect(injections[0].credential.walletId).toBe(walletA)
      expect(await asTenant(walletA, (tx) => tx.executionToken.findUnique({ where: { id: tokenB } }))).toBeNull()
      expect(await asTenant(walletA, (tx) => tx.credentialInjection.findUnique({ where: { id: injectionB } }))).toBeNull()
    })

    it("allows an explicit authorized wallet set for subtree reporting", async () => {
      const rows = await asTenant([walletA, walletB].join(","), (tx) => tx.credentialInjection.findMany({
        include: { executionToken: true, credential: true },
      }))
      expect(rows.map((row) => row.executionToken.walletId).sort()).toEqual([walletA, walletB].sort())
    })

    it("rejects inserts and updates into another tenant's token and injection records", async () => {
      await expect(asTenant(walletA, (tx) => tx.executionToken.create({
        data: { id: randomUUID(), walletId: walletB, agentId: agentB, scope: ["k"], budgetUsd: 10, expiresAt: new Date() },
      }))).rejects.toThrow()
      await expect(asTenant(walletA, (tx) => tx.credentialInjection.create({
        data: { executionTokenId: tokenB, credentialId: credBId },
      }))).rejects.toThrow()
      await expect(asTenant(walletA, (tx) => tx.executionToken.update({
        where: { id: tokenA }, data: { walletId: walletB },
      }))).rejects.toThrow()
      expect((await asTenant(walletA, (tx) => tx.executionToken.updateMany({
        where: { id: tokenB }, data: { status: "revoked" },
      }))).count).toBe(0)
      expect((await asTenant(walletA, (tx) => tx.credentialInjection.deleteMany({
        where: { id: injectionB },
      }))).count).toBe(0)
      expect((await db.executionToken.findUnique({ where: { id: tokenB } }))?.status).toBe("active")
      expect(await db.credentialInjection.findUnique({ where: { id: injectionB } })).not.toBeNull()
    })

    it("rejects mixed-wallet injection references even within an authorized subtree", async () => {
      for (const scope of [walletA, [walletA, walletB].join(",")]) {
        await expect(asTenant(scope, (tx) => tx.credentialInjection.create({
          data: { executionTokenId: tokenA, credentialId: credBId },
        }))).rejects.toThrow()
      }
      await expect(asTenant([walletA, walletB].join(","), (tx) => tx.credentialInjection.update({
        where: { id: injectionB }, data: { executionTokenId: tokenA },
      }))).rejects.toThrow()
      expect((await db.credentialInjection.findUnique({ where: { id: injectionB } }))?.executionTokenId).toBe(tokenB)
      // An owner can bypass RLS; legacy inconsistent rows must remain hidden
      // from the app rather than producing broken required-relation joins.
      const inconsistent = await db.credentialInjection.create({
        data: { executionTokenId: tokenA, credentialId: credBId },
      })
      try {
        expect(await asTenant([walletA, walletB].join(","), (tx) => tx.credentialInjection.findUnique({
          where: { id: inconsistent.id }, include: { credential: true, executionToken: true },
        }))).toBeNull()
      } finally {
        await db.credentialInjection.delete({ where: { id: inconsistent.id } })
      }
    })

    it("fails closed without scope and resets scope after commit and rollback", async () => {
      // Check on the same connection immediately after a scoped transaction,
      // rather than letting a pool choose an unrelated connection.
      const adapter = new PrismaPg({ connectionString: appRoleUrl(adminUrl), max: 1 })
      const client = new PrismaClient({ adapter })
      try {
        for (const rollback of [false, true]) {
          const scoped = client.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.wallet_ids', ${walletA}, true)`
            expect(await tx.executionToken.count()).toBe(1)
            expect(await tx.credentialInjection.count()).toBe(1)
            if (rollback) throw new Error("intentional rollback")
          })
          if (rollback) await expect(scoped).rejects.toThrow("intentional rollback")
          else await scoped
          expect(await client.executionToken.count()).toBe(0)
          expect(await client.credentialInjection.count()).toBe(0)
        }
        await expect(client.executionToken.create({
          data: { id: randomUUID(), walletId: walletA, agentId: agentA, scope: [], budgetUsd: 1, expiresAt: new Date() },
        })).rejects.toThrow()
        await expect(client.credentialInjection.create({
          data: { executionTokenId: tokenB, credentialId: credBId },
        })).rejects.toThrow()
      } finally {
        await client.$disconnect()
      }
    })

    it("does not accept the obsolete current_wallet GUC as vault or execution scope", async () => {
      await appClient.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_wallet', ${walletA}, true)`
        expect(await tx.credentialVault.count()).toBe(0)
        expect(await tx.executionToken.count()).toBe(0)
        expect(await tx.credentialInjection.count()).toBe(0)
      })
    })
  })
})
