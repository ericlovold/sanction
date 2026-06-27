import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { db } from "../lib/db"
import { encryptCredential } from "../lib/jwt"

// SEC-3 RLS proof. Postgres bypasses RLS for superusers, so this MUST run as a
// non-superuser role to be meaningful (production's app role is non-superuser).
// We seed as the superuser singleton `db`, then exercise the vault as a freshly
// created non-superuser role `sanction_app` to prove the policy confines it.
//
//   RUN_DB_TESTS=1 DATABASE_URL="postgres://…disposable…" npx vitest run tests/rls.db.test.ts
const run = process.env.RUN_DB_TESTS === "1"

describe.skipIf(!run)("SEC-3: RLS confines CredentialVault to its tenant", () => {
  let appClient: PrismaClient
  let walletA = ""
  let walletB = ""
  let credBId = ""

  beforeAll(async () => {
    // Non-superuser app role (idempotent).
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
    await db.credentialVault.create({
      data: { walletId: walletA, label: "k", type: "api_key", encryptedValue: encryptCredential("secretA", walletA, "k") },
    })
    const cb = await db.credentialVault.create({
      data: { walletId: walletB, label: "k", type: "api_key", encryptedValue: encryptCredential("secretB", walletB, "k") },
    })
    credBId = cb.id

    const base = process.env.DATABASE_URL!
    const appUrl = base.replace(/\/\/[^@]+@/, "//sanction_app:app@")
    appClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: appUrl }) })
  })

  afterAll(async () => {
    await appClient?.$disconnect()
    if (walletA) {
      await db.credentialVault.deleteMany({ where: { walletId: { in: [walletA, walletB] } } })
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

  it("tenant A sees only its own credential — even with NO where clause", async () => {
    const rows = await asTenant(walletA, (tx) => tx.credentialVault.findMany({}))
    expect(rows).toHaveLength(1)
    expect(rows[0].walletId).toBe(walletA)
  })

  it("tenant A cannot read tenant B's credential by id", async () => {
    const row = await asTenant(walletA, (tx) => tx.credentialVault.findFirst({ where: { id: credBId } }))
    expect(row).toBeNull()
  })

  it("tenant A cannot write into tenant B's vault (WITH CHECK blocks it)", async () => {
    await expect(
      asTenant(walletA, (tx) =>
        tx.credentialVault.create({
          data: { walletId: walletB, label: "x", type: "api_key", encryptedValue: "x" },
        }),
      ),
    ).rejects.toThrow()
  })

  it("with no tenant context set, the vault is invisible (fail-closed)", async () => {
    const rows = await appClient.credentialVault.findMany({})
    expect(rows).toHaveLength(0)
  })
})
