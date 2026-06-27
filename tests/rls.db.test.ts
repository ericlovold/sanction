import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { db } from "../lib/db"
import { encryptCredential } from "../lib/jwt"
import { generateApiKey } from "../lib/apiKey"

// SEC-3 RLS proof. Postgres bypasses RLS for superusers, so this MUST run as a
// non-superuser role to be meaningful (production's app role is non-superuser).
// We seed as the superuser singleton `db`, then exercise each RLS-protected table
// as a freshly created non-superuser role `sanction_app` to prove the policy
// confines it. One describe block per RLS-enabled table; the Phase-2 loop appends.
//
//   RUN_DB_TESTS=1 DATABASE_URL="postgres://…disposable…" npx vitest run tests/rls.db.test.ts
const run = process.env.RUN_DB_TESTS === "1"

describe.skipIf(!run)("SEC-3: RLS confines tenant tables to their wallet", () => {
  let appClient: PrismaClient
  let walletA = ""
  let walletB = ""
  let agentA = ""
  let agentB = ""
  let credBId = ""

  beforeAll(async () => {
    // Non-superuser app role (idempotent) + DML grants.
    await db.$executeRawUnsafe(
      `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='sanction_app') THEN CREATE ROLE sanction_app LOGIN PASSWORD 'app'; END IF; END $$;`,
    )
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO sanction_app;`)
    await db.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sanction_app;`)

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

    await db.credentialVault.create({
      data: { walletId: walletA, label: "k", type: "api_key", encryptedValue: encryptCredential("secretA", walletA, "k") },
    })
    const cb = await db.credentialVault.create({
      data: { walletId: walletB, label: "k", type: "api_key", encryptedValue: encryptCredential("secretB", walletB, "k") },
    })
    credBId = cb.id

    await db.agentClearance.create({ data: { walletId: walletA, agentId: agentA, level: 3 } })
    await db.agentClearance.create({ data: { walletId: walletB, agentId: agentB, level: 5 } })

    const appUrl = process.env.DATABASE_URL!.replace(/\/\/[^@]+@/, "//sanction_app:app@")
    appClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: appUrl }) })
  })

  afterAll(async () => {
    await appClient?.$disconnect()
    if (walletA) {
      await db.agentClearance.deleteMany({ where: { walletId: { in: [walletA, walletB] } } })
      await db.credentialVault.deleteMany({ where: { walletId: { in: [walletA, walletB] } } })
      await db.agent.deleteMany({ where: { walletId: { in: [walletA, walletB] } } })
      await db.wallet.deleteMany({ where: { id: { in: [walletA, walletB] } } })
    }
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
})
