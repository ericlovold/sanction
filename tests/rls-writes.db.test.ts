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
// assert the write actually landed. Seeding uses the owner connection.
//
//   RUN_DB_TESTS=1 DATABASE_URL="postgres://…disposable…" npx vitest run tests/rls-writes.db.test.ts
const run = process.env.RUN_DB_TESTS === "1"

const { sessionMock } = vi.hoisted(() => ({ sessionMock: { requireSessionRole: vi.fn() } }))
vi.mock("@/lib/db", async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg")
  const { PrismaClient } = await import("../lib/generated/prisma/client")
  const { appRoleUrl } = await import("./setup/db-app-role")
  const url = appRoleUrl(process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? "postgres://x@localhost/x")
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) }
})
vi.mock("@/lib/session", () => sessionMock)
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { db as appDb } from "../lib/db"
import { disconnectProviderAction } from "../app/dashboard/providers/actions"
import { moveAgentToPoolAction } from "../app/dashboard/pools/actions"
import { POST as batchCreate } from "../app/api/v1/agents/batch/route"
import { PROVIDERS } from "../lib/providers"
import { withTenant } from "../lib/rls"

describe.skipIf(!run)("SEC-3: tenant-table writes go through withTenant", () => {
  let admin: PrismaClient
  let parent = ""
  let child = ""
  let agentId = ""
  let other = ""
  let otherAgentId = ""
  let otherCredId = ""
  const mgmt = generateApiKey()

  beforeAll(async () => {
    // Owner connection for seeding; sanction_app is provisioned by the global setup.
    admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL! }) })
    const role = await appDb.$queryRaw<{ super: string; bypass: boolean }[]>`
      SELECT current_setting('is_superuser') AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`
    // Superusers and BYPASSRLS roles skip RLS entirely; either would prove nothing.
    expect(role[0].super).toBe("off")
    expect(role[0].bypass).toBe(false)

    const ts = Date.now()
    parent = (await admin.wallet.create({ data: { name: "P", ownerEmail: `p-${ts}@e.com`, mgmtKeyHash: mgmt.hash, mgmtKeyPrefix: mgmt.prefix } })).id
    child = (await admin.wallet.create({ data: { name: "C", ownerEmail: `c-${ts}@e.com`, parentId: parent } })).id
    const k = generateApiKey()
    agentId = (await admin.agent.create({ data: { walletId: parent, name: "mover", apiKeyHash: k.hash, apiKeyPrefix: k.prefix } })).id
    await admin.agentClearance.create({ data: { walletId: parent, agentId, level: 3 } })
    other = (await admin.wallet.create({ data: { name: "O", ownerEmail: `o-${ts}@e.com` } })).id
    const ok = generateApiKey()
    otherAgentId = (await admin.agent.create({ data: { walletId: other, name: "other", apiKeyHash: ok.hash, apiKeyPrefix: ok.prefix } })).id
    await admin.agentClearance.create({ data: { walletId: other, agentId: otherAgentId, level: 4 } })
    otherCredId = (
      await admin.credentialVault.create({
        data: { walletId: other, label: "other-secret", type: "api_key", encryptedValue: encryptCredential("sk-other", other, "other-secret") },
      })
    ).id
    sessionMock.requireSessionRole.mockResolvedValue({ id: parent })
  })

  afterAll(async () => {
    if (parent) {
      const ids = [parent, child, other].filter(Boolean)
      await admin.agentClearance.deleteMany({ where: { walletId: { in: ids } } })
      await admin.credentialVault.deleteMany({ where: { walletId: { in: ids } } })
      await admin.agent.deleteMany({ where: { walletId: { in: ids } } })
      await admin.wallet.deleteMany({ where: { id: { in: [child, other].filter(Boolean) } } })
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
    expect(after).not.toBeNull()
    expect(after!.revokedAt).toBeInstanceOf(Date)
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

  it("another tenant's CredentialVault row is invisible and unwritable under this tenant's scope", async () => {
    const seen = await withTenant(parent, (tx) => tx.credentialVault.findUnique({ where: { id: otherCredId } }))
    expect(seen).toBeNull()
    const { count } = await withTenant(parent, (tx) =>
      tx.credentialVault.updateMany({ where: { id: otherCredId }, data: { revokedAt: new Date() } }),
    )
    expect(count).toBe(0)
    const row = await admin.credentialVault.findUnique({ where: { id: otherCredId } })
    expect(row).not.toBeNull()
    expect(row!.revokedAt).toBeNull()
  })

  it("another tenant's AgentClearance row is invisible and unwritable under this tenant's scope", async () => {
    const seen = await withTenant(parent, (tx) => tx.agentClearance.findUnique({ where: { agentId: otherAgentId } }))
    expect(seen).toBeNull()
    const { count } = await withTenant(parent, (tx) =>
      tx.agentClearance.updateMany({ where: { agentId: otherAgentId }, data: { level: 1 } }),
    )
    expect(count).toBe(0)
    expect((await admin.agentClearance.findUnique({ where: { agentId: otherAgentId } }))?.level).toBe(4)
  })
})
