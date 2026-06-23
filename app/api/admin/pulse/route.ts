import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * Adoption pulse — owner-only, guarded by SANCTION_ADMIN_SECRET (x-admin-secret).
 * The "are real people using this yet?" number at a glance: raw totals plus an
 * EXTERNAL view that excludes your own wallet and AIIA's, so adoption isn't
 * inflated by dogfooding.
 *
 * Internal exclusion:
 *   - SANCTION_WALLET_ID         — the primary/AIIA wallet (excluded by id)
 *   - SANCTION_INTERNAL_EMAILS   — comma-separated owner emails to exclude
 *                                  (set this to your own + AIIA's for a clean count)
 */
export async function GET(req: NextRequest) {
  const adminSecret = process.env.SANCTION_ADMIN_SECRET
  if (!adminSecret) {
    return NextResponse.json({ error: "Disabled: SANCTION_ADMIN_SECRET not configured" }, { status: 503 })
  }
  if (!constantTimeEqual(req.headers.get("x-admin-secret") ?? "", adminSecret)) {
    return NextResponse.json({ error: "Invalid admin secret" }, { status: 401 })
  }

  const internalWalletIds = [process.env.SANCTION_WALLET_ID].filter((v): v is string => !!v)
  const internalEmails = (process.env.SANCTION_INTERNAL_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)

  // Filter that drops internal (your own + AIIA) wallets.
  const externalWallet = { id: { notIn: internalWalletIds }, ownerEmail: { notIn: internalEmails } }

  const [walletsTotal, agentsTotal, leadsTotal, authExternal, tokenExternal, externalWallets] = await Promise.all([
    db.wallet.count(),
    db.agent.count(),
    db.lead.count(),
    db.authorizationRequest.count({ where: { agent: { wallet: externalWallet } } }),
    db.tokenLog.count({ where: { agent: { wallet: externalWallet } } }),
    db.wallet.findMany({
      where: externalWallet,
      orderBy: { createdAt: "desc" },
      select: {
        name: true,
        ownerEmail: true,
        createdAt: true,
        agents: { select: { _count: { select: { authRequests: true, tokenLogs: true } } } },
      },
    }),
  ])

  const signups = externalWallets.map((w) => {
    const actions = w.agents.reduce((n, a) => n + a._count.authRequests + a._count.tokenLogs, 0)
    return { email: w.ownerEmail, name: w.name, createdAt: w.createdAt, agents: w.agents.length, actions, active: actions > 0 }
  })

  return NextResponse.json(
    {
      totals: { wallets: walletsTotal, agents: agentsTotal, leads: leadsTotal },
      external: {
        wallets: signups.length,
        active: signups.filter((s) => s.active).length,
        authorizations: authExternal,
        tokenCalls: tokenExternal,
      },
      recentSignups: signups.slice(0, 25),
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
