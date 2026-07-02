import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"
import { authenticateAgent } from "@/lib/auth"
import { authEventType, mergeEvents } from "@/lib/reporting"

// Unified, time-sorted audit feed for a wallet: spend decisions, token usage, and
// credential injections (secret access). The "what did my agents do?" surface —
// a read model over the distributed audit tables (AuthorizationRequest, TokenLog,
// CredentialInjection). Readable by the wallet owner (x-mgmt-key) or any active
// agent in the wallet (x-api-key) — same membership check as /wallets/stats.
export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400 })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) {
    const { agent } = await authenticateAgent(req)
    if (!agent || agent.walletId !== walletId) {
      return NextResponse.json({ error: "Unauthorized: management key or wallet agent key required" }, { status: 401 })
    }
  }

  const type = req.nextUrl.searchParams.get("type") // authorization | token | injection
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 50, 1), 200)
  const beforeParam = req.nextUrl.searchParams.get("before")
  const before = beforeParam ? new Date(beforeParam) : undefined
  if (before && Number.isNaN(before.getTime())) {
    return NextResponse.json({ error: "before must be an ISO timestamp" }, { status: 400 })
  }

  const agents = await db.agent.findMany({ where: { walletId }, select: { id: true, name: true } })
  const agentIds = agents.map((a) => a.id)
  const nameOf = new Map(agents.map((a) => [a.id, a.name]))
  const createdAt = before ? { lt: before } : undefined

  const wantAuth = !type || type === "authorization"
  const wantToken = !type || type === "token"
  const wantInjection = !type || type === "injection"

  const [auths, tokens, injections] = await Promise.all([
    wantAuth
      ? db.authorizationRequest.findMany({ where: { agentId: { in: agentIds }, createdAt }, orderBy: { createdAt: "desc" }, take: limit })
      : [],
    wantToken
      ? db.tokenLog.findMany({ where: { agentId: { in: agentIds }, createdAt }, orderBy: { createdAt: "desc" }, take: limit })
      : [],
    wantInjection
      ? db.credentialInjection.findMany({
          where: { executionToken: { walletId }, injectedAt: before ? { lt: before } : undefined },
          orderBy: { injectedAt: "desc" },
          take: limit,
          include: { credential: { select: { label: true } }, executionToken: { select: { agentId: true } } },
        })
      : [],
  ])

  type Ev = { type: string; id: string; at: string; agent_id: string; agent_name?: string; [k: string]: unknown }
  const events = mergeEvents<Ev>(
    [
      auths.map((a): Ev => ({
        type: authEventType(a.status),
        id: a.id,
        at: a.createdAt.toISOString(),
        agent_id: a.agentId,
        agent_name: nameOf.get(a.agentId),
        action: a.action,
        amount_usd: a.amountUsd,
        merchant: a.merchant,
        category: a.category,
        status: a.status,
        reason: a.decisionNote ?? undefined,
      })),
      tokens.map((t): Ev => ({
        type: "token.logged",
        id: t.id,
        at: t.createdAt.toISOString(),
        agent_id: t.agentId,
        agent_name: nameOf.get(t.agentId),
        model: t.model,
        cost_usd: t.costUsd,
        tokens_in: t.tokensIn,
        tokens_out: t.tokensOut,
        task_label: t.taskLabel ?? undefined,
      })),
      injections.map((inj): Ev => ({
        type: "vault.injection",
        id: inj.id,
        at: inj.injectedAt.toISOString(),
        agent_id: inj.executionToken.agentId,
        agent_name: nameOf.get(inj.executionToken.agentId),
        credential_label: inj.credential.label,
        execution_token_id: inj.executionTokenId,
      })),
    ],
    limit,
  )

  const nextBefore = events.length === limit ? events[events.length - 1].at : null
  return NextResponse.json({ wallet_id: walletId, events, next_before: nextBefore }, { headers: { "Cache-Control": "no-store" } })
}
