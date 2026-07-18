// Dev-only owner-side approval for the tester's escalation loop: approve or deny
// the oldest pending escalation (mirrors examples/eve-testers/scripts/approve.sh).
// Uses the management key server-side; the browser never sees it.

import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

function enabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.MCP_TESTER_ENABLED === "1"
}

export async function POST(req: NextRequest) {
  if (!enabled()) {
    return NextResponse.json({ error: "mcp-tester is disabled in production" }, { status: 404 })
  }
  const mgmtKey = process.env.SANCTION_MGMT_KEY
  const walletId = process.env.SANCTION_WALLET_ID
  if (!mgmtKey || !walletId) {
    return NextResponse.json(
      { error: "SANCTION_MGMT_KEY and SANCTION_WALLET_ID must be set (run examples/eve-testers/scripts/provision-demo.sh)" },
      { status: 400 },
    )
  }
  const apiUrl = process.env.SANCTION_API_URL ?? "https://getsanction.com/api/v1"
  let decision = "approve"
  try {
    const body = await req.json()
    if (body?.decision === "deny") decision = "deny"
  } catch {
    // empty body → approve
  }

  try {
    const pendingRes = await fetch(`${apiUrl}/approvals?wallet_id=${encodeURIComponent(walletId)}`, {
      headers: { "x-mgmt-key": mgmtKey },
      signal: AbortSignal.timeout(15_000),
    })
    const pendingBody = await pendingRes.json()
    const pending: Array<{ id: string }> = Array.isArray(pendingBody?.pending) ? pendingBody.pending : []
    if (pending.length === 0) {
      return NextResponse.json({ ok: true, decided: null, message: "no pending approvals" })
    }
    const requestId = pending[0].id
    const decideRes = await fetch(`${apiUrl}/approvals`, {
      method: "POST",
      headers: { "x-mgmt-key": mgmtKey, "content-type": "application/json" },
      body: JSON.stringify({ wallet_id: walletId, request_id: requestId, decision, note: `${decision} by owner (mcp-tester)` }),
      signal: AbortSignal.timeout(15_000),
    })
    const decideBody = await decideRes.json().catch(() => ({}))
    return NextResponse.json({ ok: decideRes.ok, decided: requestId, decision, result: decideBody })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: `approvals call failed: ${detail}` }, { status: 502 })
  }
}
