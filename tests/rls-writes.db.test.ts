import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import { NextRequest } from "next/server"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { encryptCredential } from "../lib/jwt"
import { generateApiKey } from "../lib/apiKey"

// SEC-3 write paths. CredentialVault and AgentClearance are FORCE RLS, so a
// write issued outside withTenant() matches zero rows (or is rejected) for the
// production non-superuser role — the mutation silently does nothing. These run
// the real actions/routes with the app's `db` bound to a non-superuser role and
// assert the write actually landed. Seeding uses the superuser connection.
//
//   RUN_DB_TESTS=1 DATABASE_URL="postgres://…disposable…" npx vitest run tests/rls-writes.db.test.ts
const run = process.env.RUN_DB_TESTS === "1"

const { sessionMock } = vi.hoisted(() => ({ sessionMock: { requireSessionRole: vi.fn() } }))
vi.mock("@/lib/db", async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg")
  const { PrismaClient } = await import("../lib/generated/prisma/client")
  const url = (process.env.DATABASE_URL ?? "").replace(/\/\/[^@]+@/, "//sanction_app:app@")
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) }
})
vi.mock("@/lib/session", () => sessionMock)
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { db as appDb } from "../lib/db"
import { disconnectProviderAction } from "../app/dashboard/providers/actions"
import { moveAgentToPoolAction } from "../app/dashboard/pools/actions"
import { POST as batchCreate } from "../app/api/v1/agents/batch/route"
import { PROVIDERS } from "../lib/providers"

describe.skipIf(!run)("SEC-3: tenant-table writes go through withTenant", () => {
  let admin: PrismaClient
  let parent = ""
  let child = ""
  let agentId = ""
  const mgmt = generateApiKey()

  beforeAll(async () => {
    admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
    await admin.$executeRawUnsafe(
      `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='sanction_app') THEN CREATE ROLE sanction_app LOGIN PASSWORD 'app'; END IF; END $$;`,
    )
    await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO sanction_app;`)
    await admin.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sanction_app;`)
    const role = await appDb.$queryRaw<{ super: string }[]>`SELECT current_setting('is_superuser') AS super`
    expect(role[0].super).toBe("off") // otherwise RLS is bypassed and this proves nothing

    const ts = Date.now()
    parent = (await admin.wallet.create({ data: { name: "P", ownerEmail: `p-${ts}@e.com`, mgmtKeyHash: mgmt.hash, mgmtKeyPrefix: mgmt.prefix } })).id
    child = (await admin.wallet.create({ data: { name: "C", ownerEmail: `c-${ts}@e.com`, parentId: parent } })).id
    const k = generateApiKey()
    agentId = (await admin.agent.create({ data: { walletId: parent, name: "mover", apiKeyHash: k.hash, apiKeyPrefix: k.prefix } })).id
    await admin.agentClearance.create({ data: { walletId: parent, agentId, level: 3 } })
    sessionMock.requireSessionRole.mockResolvedValue({ id: parent })
  })

  afterAll(async () => {
    if (parent) {
      const ids = [parent, child]
      await admin.agentClearance.deleteMany({ where: { walletId: { in: ids } } })
      await admin.credentialVault.deleteMany({ where: { walletId: { in: ids } } })
      await admin.agent.deleteMany({ where: { walletId: { in: ids } } })
      await admin.wallet.deleteMany({ where: { id: child } })
      await admin.wallet.deleteMany({ where: { id: parent } })
    }
    await admin?.$disconnect()
    await appDb.$disconnect()
  })

  it("disconnectProviderAction actually revokes the provider key", async () => {
    const info = PROVIDERS[0]
    const cred = await admin.credentialVault.create({
      data: { walletId: parent, label: info.vaultLabel, type: "api_key", encryptedValue: encryptCredential("sk-live", parent, info.vaultLabel) },
    })
    const form = new FormData()
    form.set("provider", info.id)
    await disconnectProviderAction(form)
    const after = await admin.credentialVault.findUnique({ where: { id: cred.id } })
    expect(after?.revokedAt).not.toBeNull()
  })

  it("moveAgentToPoolAction moves the agent AND its clearance row", async () => {
    const form = new FormData()
    form.set("agent_id", agentId)
    form.set("target_wallet_id", child)
    const res = await moveAgentToPoolAction({ ok: false, message: "" }, form)
    expect(res.ok).toBe(true)
    expect((await admin.agent.findUnique({ where: { id: agentId } }))?.walletId).toBe(child)
    expect((await admin.agentClearance.findUnique({ where: { agentId } }))?.walletId).toBe(child)
  })

  it("POST /agents/batch with a clearance template creates the seats", async () => {
    const req = new NextRequest("https://test.local/api/v1/agents/batch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-mgmt-key": mgmt.raw },
      body: JSON.stringify({ wallet_id: parent, seats: [{ name: "seat-1" }], template: { clearance: 2 } }),
    })
    const res = await batchCreate(req)
    expect(res.status).toBe(201)
    const [seat] = (await res.json()).seats
    expect((await admin.agentClearance.findUnique({ where: { agentId: seat.id } }))?.level).toBe(2)
  })
})
