import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import { randomBytes } from "crypto"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { generateApiKey, generateManagementKey, hashApiKey } from "../lib/apiKey"

// Magic-link claim against real Postgres, with the app client as the restricted
// `sanction_app` role. A squatter creates a wallet under the victim's email
// (unverified), mints an agent, a live execution token, and a webhook. The
// victim's first magic link must rotate all of it in one transaction and mark
// ownerEmail verified — mocks can't prove the set-based SQL, the RLS scoping
// on SlackInstall, or that Webhook has no FK dependents blocking the delete.
//
//   RUN_DB_TESTS=1 DATABASE_URL="postgres://…disposable…" npx vitest run tests/magic-link-claim.db.test.ts
const run = process.env.RUN_DB_TESTS === "1"

const { cookieStore } = vi.hoisted(() => ({ cookieStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } }))
vi.mock("@/lib/db", async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg")
  const { PrismaClient } = await import("../lib/generated/prisma/client")
  const { appRoleUrl } = await import("./setup/db-app-role")
  const url = appRoleUrl(process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? "postgres://x@localhost/x")
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) }
})
vi.mock("next/headers", () => ({ cookies: async () => cookieStore, headers: async () => new Headers() }))
vi.mock("@/lib/auth-config", () => ({ auth: { api: { getSession: vi.fn(), signOut: vi.fn() } } }))

import { verifyMagicLinkAction } from "../app/login/actions"

describe.skipIf(!run)("magic-link claim rotates a squatted wallet", () => {
  let admin: PrismaClient
  let walletId = ""
  let agentId = ""
  const email = `victim-${Date.now()}@example.test`
  const squatterAgentKey = generateApiKey()

  beforeAll(async () => {
    admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL! }) })
    const sq = generateManagementKey()
    walletId = (await admin.wallet.create({ data: { name: "squat", ownerEmail: email, mgmtKeyHash: sq.hash, mgmtKeyPrefix: sq.prefix } })).id
    agentId = (
      await admin.agent.create({
        data: { walletId, name: "squatter-agent", apiKeyHash: squatterAgentKey.hash, apiKeyPrefix: squatterAgentKey.prefix },
      })
    ).id
    await admin.executionToken.create({
      data: { id: `jti-${Date.now()}`, agentId, walletId, scope: [], budgetUsd: 10, expiresAt: new Date(Date.now() + 900_000) },
    })
    await admin.webhook.create({ data: { walletId, url: "https://squatter.example/hook", secret: "whsec_x" } })
  })

  afterAll(async () => {
    if (walletId) {
      await admin.magicLink.deleteMany({ where: { walletId } })
      await admin.executionToken.deleteMany({ where: { walletId } })
      await admin.webhook.deleteMany({ where: { walletId } })
      await admin.agent.deleteMany({ where: { walletId } })
      await admin.wallet.deleteMany({ where: { id: walletId } })
    }
    await admin?.$disconnect()
  })

  async function verify() {
    const raw = randomBytes(32).toString("hex")
    await admin.magicLink.create({ data: { tokenHash: hashApiKey(raw), walletId, email, expiresAt: new Date(Date.now() + 60_000) } })
    const f = new FormData()
    f.set("token", raw)
    return verifyMagicLinkAction({ ok: false, error: "" }, f)
  }

  it("first proof: agent key rotated + inactive, token revoked, webhook deleted, verifiedAt set", async () => {
    const res = await verify()
    expect(res.ok).toBe(true)
    expect(res.rotatedAgents).toBe(1)

    const agent = await admin.agent.findUniqueOrThrow({ where: { id: agentId } })
    expect(agent.apiKeyHash).not.toBe(squatterAgentKey.hash)
    expect(agent.apiKeyHash.startsWith("claimed:")).toBe(true)
    expect(agent.isActive).toBe(false)

    const tokens = await admin.executionToken.findMany({ where: { walletId } })
    expect(tokens.every((t) => t.status === "revoked" && t.revokedAt)).toBe(true)
    expect(await admin.webhook.count({ where: { walletId } })).toBe(0)

    const wallet = await admin.wallet.findUniqueOrThrow({ where: { id: walletId } })
    expect(wallet.ownerEmailVerifiedAt).toBeInstanceOf(Date)
    expect(wallet.mgmtKeyHash).toBe(hashApiKey(res.newKey!))
  })

  it("second proof on the now-verified wallet rotates only the sk_ key", async () => {
    const k = generateApiKey()
    const liveAgent = await admin.agent.create({ data: { walletId, name: "owner-agent", apiKeyHash: k.hash, apiKeyPrefix: k.prefix } })

    const res = await verify()
    expect(res.ok).toBe(true)
    expect(res.rotatedAgents).toBeUndefined()

    const agent = await admin.agent.findUniqueOrThrow({ where: { id: liveAgent.id } })
    expect(agent.apiKeyHash).toBe(k.hash)
    expect(agent.isActive).toBe(true)
    expect((await admin.wallet.findUniqueOrThrow({ where: { id: walletId } })).mgmtKeyHash).toBe(hashApiKey(res.newKey!))
  })
})
