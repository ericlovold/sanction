import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { db } from "../lib/db"
import { generateApiKey } from "../lib/apiKey"

// Next's after() defers work past the response and only runs inside a real request
// scope; calling the handler directly in a test trips it. Stub it to a no-op (the
// deferred webhook delivery is irrelevant to what this test checks).
vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>()
  return { ...mod, after: () => {} }
})

// DB-backed concurrency test for the daily-budget advisory lock — the budget-leak
// scenario the unit tests can't reach (Postgres locking has no mock equivalent).
//
// GATED: runs only when RUN_DB_TESTS=1, and you MUST point DATABASE_URL at a
// DISPOSABLE test database (a Neon branch) — NEVER prod. It writes + deletes rows.
//   RUN_DB_TESTS=1 DATABASE_URL="postgres://…neon-branch…" npx vitest run tests/concurrency.db.test.ts
//
// NOTE: authored but not yet executed in this environment (no DB reachable). First
// run against a real test DB is the verification step.
const run = process.env.RUN_DB_TESTS === "1"

describe.skipIf(!run)("daily budget holds under concurrency (no leak)", () => {
  let walletId: string
  let agentKey: string

  beforeAll(async () => {
    const key = generateApiKey()
    const wallet = await db.wallet.create({
      data: {
        name: "ctest",
        ownerEmail: `ctest+${Date.now()}@example.com`,
        mgmtKeyHash: `ctest_${Date.now()}`,
        mgmtKeyPrefix: "sk_ctest",
        // $50/day budget; huge per-txn + auto-approve floor so ONLY the daily
        // budget can stop a charge — isolating the locked daily-spend check.
        policy: { create: { dailySpendBudgetUsd: 5000, perTransactionMaxUsd: 1_000_000, autoApproveUnderUsd: 1_000_000, escalateOverUsd: 1_000_000 } },
        agents: { create: { name: "a", apiKeyHash: key.hash, apiKeyPrefix: key.prefix } },
      },
    })
    walletId = wallet.id
    agentKey = key.raw
  })

  afterAll(async () => {
    if (!walletId) return
    const agents = await db.agent.findMany({ where: { walletId }, select: { id: true } })
    await db.authorizationRequest.deleteMany({ where: { agentId: { in: agents.map((a) => a.id) } } })
    await db.walletBudgetCounter.deleteMany({ where: { walletId } })
    await db.agent.deleteMany({ where: { walletId } })
    await db.policy.deleteMany({ where: { walletId } })
    await db.wallet.delete({ where: { id: walletId } })
  })

  it("10 concurrent $10 charges against a $50/day budget approve at most $50", async () => {
    const { POST } = await import("@/app/api/v1/authorize/route")
    const call = () =>
      POST(
        new NextRequest("https://test.local/api/v1/authorize", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": agentKey },
          body: JSON.stringify({ action: "purchase", amount_usd: 10, merchant: "x", category: "software" }),
        }),
      )
    const results = await Promise.all(Array.from({ length: 10 }, call))
    const decisions = await Promise.all(results.map((r) => r.json()))
    const approvedUsd = decisions.filter((d) => d.status === "approved").length * 10
    // The advisory lock must serialize the daily-budget check — never over $50.
    expect(approvedUsd).toBeLessThanOrEqual(50)
  })
})

describe.skipIf(!run)("subtree daily cap holds under concurrency (no sibling leak)", () => {
  let rootId: string
  let walletIds: string[] = []
  const agentKeys: string[] = []

  beforeAll(async () => {
    const stamp = Date.now()
    const root = await db.wallet.create({
      data: {
        name: "subtree-root",
        ownerEmail: `subtree-root+${stamp}@example.com`,
        mgmtKeyHash: `subtree_root_${stamp}`,
        mgmtKeyPrefix: "sk_subtree",
        policy: {
          create: {
            dailySpendBudgetUsd: 1_000_000,
            subtreeDailyCapUsd: 5000,
            perTransactionMaxUsd: 1_000_000,
            autoApproveUnderUsd: 1_000_000,
            escalateOverUsd: 1_000_000,
          },
        },
      },
    })
    rootId = root.id

    for (let i = 0; i < 2; i++) {
      const key = generateApiKey()
      const child = await db.wallet.create({
        data: {
          name: `subtree-child-${i}`,
          ownerEmail: `subtree-child-${i}+${stamp}@example.com`,
          parentId: root.id,
          mgmtKeyHash: `subtree_child_${i}_${stamp}`,
          mgmtKeyPrefix: "sk_subtree",
          policy: { create: { dailySpendBudgetUsd: 1_000_000, perTransactionMaxUsd: 1_000_000, autoApproveUnderUsd: 1_000_000, escalateOverUsd: 1_000_000 } },
          agents: { create: { name: `a-${i}`, apiKeyHash: key.hash, apiKeyPrefix: key.prefix } },
        },
      })
      walletIds.push(child.id)
      agentKeys.push(key.raw)
    }
    walletIds = [root.id, ...walletIds]
  })

  afterAll(async () => {
    if (!rootId) return
    const agents = await db.agent.findMany({ where: { walletId: { in: walletIds } }, select: { id: true } })
    await db.authorizationRequest.deleteMany({ where: { agentId: { in: agents.map((a) => a.id) } } })
    await db.walletBudgetCounter.deleteMany({ where: { walletId: { in: walletIds } } })
    await db.agent.deleteMany({ where: { walletId: { in: walletIds } } })
    await db.policy.deleteMany({ where: { walletId: { in: walletIds } } })
    await db.wallet.deleteMany({ where: { id: { in: walletIds.filter((id) => id !== rootId) } } })
    await db.wallet.delete({ where: { id: rootId } })
  })

  it("sibling agents under one capped parent approve at most the parent cap", async () => {
    const { POST } = await import("@/app/api/v1/authorize/route")
    const call = (_: unknown, i: number) =>
      POST(
        new NextRequest("https://test.local/api/v1/authorize", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": agentKeys[i % agentKeys.length] },
          body: JSON.stringify({ action: "purchase", amount_usd: 10, merchant: "x", category: "software" }),
        }),
      )
    const results = await Promise.all(Array.from({ length: 10 }, call))
    const decisions = await Promise.all(results.map((r) => r.json()))
    const approvedUsd = decisions.filter((d) => d.status === "approved").length * 10

    expect(approvedUsd).toBeLessThanOrEqual(50)
    expect(decisions.some((d) => d.code === "SUBTREE_CAP_EXCEEDED")).toBe(true)
  })
})
