import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * The adoption funnel — the denominator behind the npm/MCP download graph.
 * Owner-only, guarded by SANCTION_ADMIN_SECRET (x-admin-secret header), JSON.
 *
 * "Real" excludes the seeded demo fleet (every demo wallet is named "Demo — …").
 * The funnel is: a real wallet is created → it provisions a seat → the seat makes
 * its first governed decision → the wallet is active in the last 7 days. Each
 * step is where users drop, so each is worth watching against the download spike.
 */

// Demo fleet is name-prefixed; everything else is a real signup. Heuristic, but
// the only demo wallets in prod are the seeded "Demo — …" tree.
const DEMO = { name: { startsWith: "Demo —" } } as const
const REAL = { NOT: DEMO } as const

export async function GET(req: NextRequest) {
  const adminSecret = process.env.SANCTION_ADMIN_SECRET
  if (!adminSecret) {
    return NextResponse.json({ error: "Disabled: SANCTION_ADMIN_SECRET not configured" }, { status: 503 })
  }
  if (!constantTimeEqual(req.headers.get("x-admin-secret") ?? "", adminSecret)) {
    return NextResponse.json({ error: "Invalid admin secret" }, { status: 401 })
  }

  const now = Date.now()
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)
  const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000)
  const recentlyActive = { OR: [{ authRequests: { some: { createdAt: { gte: weekAgo } } } }, { tokenLogs: { some: { createdAt: { gte: weekAgo } } } }] }

  const [
    walletsTotal,
    walletsDemo,
    realWallets,
    withAgent,
    withAuthorize,
    active7d,
    signups7d,
    signups30d,
    decisionsTotalReal,
    decisions7dReal,
    tokenCostReal,
    recent,
  ] = await Promise.all([
    db.wallet.count(),
    db.wallet.count({ where: DEMO }),
    db.wallet.count({ where: REAL }),
    db.wallet.count({ where: { ...REAL, agents: { some: {} } } }),
    db.wallet.count({ where: { ...REAL, agents: { some: { authRequests: { some: {} } } } } }),
    db.wallet.count({ where: { ...REAL, agents: { some: recentlyActive } } }),
    db.wallet.count({ where: { ...REAL, createdAt: { gte: weekAgo } } }),
    db.wallet.count({ where: { ...REAL, createdAt: { gte: monthAgo } } }),
    db.authorizationRequest.count({ where: { agent: { wallet: REAL } } }),
    db.authorizationRequest.count({ where: { agent: { wallet: REAL }, createdAt: { gte: weekAgo } } }),
    db.tokenLog.aggregate({ where: { agent: { wallet: REAL } }, _sum: { costUsd: true } }),
    db.wallet.findMany({
      where: REAL,
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { name: true, ownerEmail: true, createdAt: true, _count: { select: { agents: true } } },
    }),
  ])

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)

  return NextResponse.json(
    {
      generated_at: new Date(now).toISOString(),
      note: "‘real’ excludes the seeded demo fleet (wallets named ‘Demo — …’).",
      wallets: { total: walletsTotal, demo: walletsDemo, real: realWallets },
      funnel: {
        signups: realWallets,
        provisioned_a_seat: withAgent,
        made_first_decision: withAuthorize,
        active_last_7d: active7d,
        // Conversion at each step, relative to signups.
        rates_pct: {
          signup_to_seat: pct(withAgent, realWallets),
          seat_to_first_decision: pct(withAuthorize, withAgent),
          signup_to_active_7d: pct(active7d, realWallets),
        },
      },
      signups: { last_7d: signups7d, last_30d: signups30d },
      activity_real: {
        decisions_total: decisionsTotalReal,
        decisions_last_7d: decisions7dReal,
        token_cost_usd_total: Math.round((tokenCostReal._sum.costUsd ?? 0) * 100) / 100,
      },
      recent_real_wallets: recent.map((w) => ({
        name: w.name,
        owner_email: w.ownerEmail,
        seats: w._count.agents,
        created_at: w.createdAt.toISOString(),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
