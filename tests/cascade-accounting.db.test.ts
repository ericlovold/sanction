import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { db } from "../lib/db"
import { generateApiKey } from "../lib/apiKey"
import { dayStart } from "../lib/cascadeBudget"

vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>()
  return { ...mod, after: () => {} }
})

// Budget accounting against real Postgres: what counts as spend for the
// per-agent daily budget and the subtree (pool) cap counters.
//   - observe-mode rows never count against an enforcing cap (OBS-1)
//   - a grant redemption reserves its amount exactly once
//   - a redemption counts on the day it happens, not the day it escalated
const run = process.env.RUN_DB_TESTS === "1"

const LOOSE = { perTransactionMaxUsd: 1_000_000, autoApproveUnderUsd: 1_000_000, escalateOverUsd: 1_000_000 }
const created: string[] = []
let stamp = 0

async function makeWallet(opts: { parentId?: string; policy: Record<string, unknown>; agent?: boolean }) {
  const n = ++stamp
  const key = generateApiKey()
  const w = await db.wallet.create({
    data: {
      name: `cacct-${n}`,
      ownerEmail: `cacct-${n}-${Date.now()}@example.com`,
      mgmtKeyHash: `cacct_${n}_${Date.now()}`,
      mgmtKeyPrefix: "sk_cacct",
      parentId: opts.parentId,
      policy: { create: { dailySpendBudgetUsd: 1_000_000, ...LOOSE, ...opts.policy } },
      ...(opts.agent ? { agents: { create: { name: `a-${n}`, apiKeyHash: key.hash, apiKeyPrefix: key.prefix } } } : {}),
    },
  })
  created.push(w.id)
  return { id: w.id, key: key.raw }
}

async function authorize(key: string, amount_usd: number, extra: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/v1/authorize/route")
  const res = await POST(
    new NextRequest("https://test.local/api/v1/authorize", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ action: "purchase", amount_usd, merchant: "m", category: "software", ...extra }),
    }),
  )
  return res.json()
}

async function counterCents(walletId: string) {
  const c = await db.walletBudgetCounter.findFirst({ where: { walletId, period: "daily", periodStart: dayStart() } })
  return c?.spentCents ?? 0
}

async function approveAndGrant(walletId: string, requestId: string) {
  const { resolveApproval } = await import("@/lib/approvals")
  const out = await resolveApproval(walletId, requestId, "approve")
  expect(out.ok).toBe(true)
  const grant = await db.grant.findFirst({ where: { sourceType: "authorization_request", sourceId: requestId } })
  expect(grant).toBeTruthy()
  return grant!.id
}

describe.skipIf(!run)("cascade + per-agent budget accounting", () => {
  afterAll(async () => {
    if (created.length === 0) return
    const agents = await db.agent.findMany({ where: { walletId: { in: created } }, select: { id: true } })
    const agentIds = agents.map((a) => a.id)
    await db.grant.deleteMany({ where: { walletId: { in: created } } })
    await db.pendingApproval.deleteMany({ where: { walletId: { in: created } } })
    await db.authorizationRequest.deleteMany({ where: { agentId: { in: agentIds } } })
    await db.walletBudgetCounter.deleteMany({ where: { walletId: { in: created } } })
    await db.agent.deleteMany({ where: { walletId: { in: created } } })
    await db.policy.deleteMany({ where: { walletId: { in: created } } })
    // children before parents
    for (const id of [...created].reverse()) await db.wallet.delete({ where: { id } })
  })

  beforeAll(() => {
    stamp = Math.floor(Math.random() * 1e6)
  })

  it("an observed pool's would-be spend never trips an enforcing sibling's shared cap", async () => {
    const root = await makeWallet({ policy: { subtreeDailyCapUsd: 100_000 } }) // $1000 pool cap
    const observed = await makeWallet({ parentId: root.id, agent: true, policy: { enforcementMode: "observe" } })
    const enforcing = await makeWallet({ parentId: root.id, agent: true, policy: {} })

    const a = await authorize(observed.key, 900)
    expect(a.would_be.status).toBe("approved")

    const b = await authorize(enforcing.key, 200)
    expect(b.status).toBe("approved")
    expect(await counterCents(root.id)).toBe(20_000)
  })

  it("observed approvals do not count against the agent's own budget once it enforces", async () => {
    const w = await makeWallet({ agent: true, policy: { enforcementMode: "observe", dailySpendBudgetUsd: 100_000 } })
    expect((await authorize(w.key, 900)).would_be.status).toBe("approved")

    // Still observing: the would-be decision stays truthful about its own spend.
    expect((await authorize(w.key, 200)).would_be.status).toBe("denied")

    await db.policy.update({ where: { walletId: w.id }, data: { enforcementMode: "enforce" } })
    expect((await authorize(w.key, 200)).status).toBe("approved")
  })

  it("tagged (non-observed) approvals still count against the agent's budget", async () => {
    const w = await makeWallet({ agent: true, policy: { dailySpendBudgetUsd: 10_000 } })
    expect((await authorize(w.key, 60, { tags: { team: "growth" } })).status).toBe("approved")
    expect((await authorize(w.key, 50)).status).toBe("denied")
  })

  it("grant redemption reserves the approved amount exactly once in the pool counter", async () => {
    const root = await makeWallet({ policy: { subtreeDailyCapUsd: 100_000 } }) // $1000 pool cap
    const child = await makeWallet({ parentId: root.id, agent: true, policy: { autoApproveUnderUsd: 1000, escalateOverUsd: 35_000 } })
    const sibling = await makeWallet({ parentId: root.id, agent: true, policy: {} })

    expect((await authorize(child.key, 200)).status).toBe("approved")
    expect((await authorize(child.key, 200)).status).toBe("approved")
    expect(await counterCents(root.id)).toBe(40_000)

    const esc = await authorize(child.key, 400)
    expect(esc.status).toBe("escalated")
    const grantId = await approveAndGrant(child.id, esc.request_id)

    // A sibling spends between approval and redemption; its reconcile must not
    // pull the not-yet-redeemed approval into the counter.
    expect((await authorize(sibling.key, 50)).status).toBe("approved")
    expect(await counterCents(root.id)).toBe(45_000)

    const redeem = await authorize(child.key, 400, { grant_id: grantId })
    expect(redeem.status).toBe("approved")
    expect(await counterCents(root.id)).toBe(85_000)
  })

  it("a redemption after midnight counts against today's agent budget, not the escalation day's", async () => {
    const w = await makeWallet({ agent: true, policy: { dailySpendBudgetUsd: 50_000, autoApproveUnderUsd: 1000, escalateOverUsd: 35_000 } })
    const esc = await authorize(w.key, 400)
    expect(esc.status).toBe("escalated")
    const yesterday = new Date(dayStart().getTime() - 60 * 60 * 1000)
    await db.authorizationRequest.update({ where: { id: esc.request_id }, data: { createdAt: yesterday } })

    const grantId = await approveAndGrant(w.id, esc.request_id)
    expect((await authorize(w.key, 400, { grant_id: grantId })).status).toBe("approved")

    // $400 redeemed today + $200 > $500 daily budget.
    expect((await authorize(w.key, 200)).status).toBe("denied")
  })
})
