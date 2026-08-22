import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "@/lib/auth"
import { agentKeyFromMcpRequest, isBrowserMcpProbe } from "@/lib/mcpRemote"
import { publicOrigin } from "@/lib/authzen"
import { clientIp, rateLimit } from "@/lib/rateLimit"
import { brokerRefusalResult, classifyBrokerBody, forwardToUpstream, loadUpstream, GRANT_META_KEY } from "@/lib/broker"
import { POST as authorizeToolPOST } from "@/app/api/v1/authorize/tool/route"
import { logger } from "@/lib/log"

export const maxDuration = 60

const log = logger("mcp/broker")
const NO_STORE = { "Cache-Control": "no-store" } as const

// BROKER-1: /mcp/broker/{upstream} — the host configures THIS URL instead of
// the upstream MCP server. Every tools/call is authorized through the same
// shell as POST /v1/authorize/tool BEFORE anything reaches the upstream; all
// other MCP traffic (initialize, tools/list, resources, ping) forwards.
//
// The authorization is a direct in-process call to the REST route's handler —
// deliberately NOT a re-implementation. One shell means broker decisions get
// idempotency, observe mode, inheritance, conditions, evidence, escalation
// side-effects, and every future rule for free, and the two surfaces cannot
// drift ("one engine, every surface" is a function call, not a discipline).

function jsonRpcError(id: string | number | null, code: number, message: string, status = 200): Response {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers: NO_STORE })
}

async function handle(req: NextRequest, ctx: { params: Promise<{ upstream: string }> }): Promise<Response> {
  const { upstream: upstreamName } = await ctx.params

  if (isBrowserMcpProbe(req)) {
    const origin = publicOrigin(req)
    return NextResponse.json(
      {
        name: `sanction-broker(${upstreamName})`,
        message:
          "This is a governed MCP broker endpoint. Configure it in your MCP host with your agent key; every tools/call is authorized by the wallet's policy before it reaches the upstream server.",
        configure: { url: `${origin}/mcp/broker/${upstreamName}`, headers: { "x-api-key": "pxy_YOUR_AGENT_KEY" } },
        register_upstreams: `POST ${origin}/api/v1/broker/upstreams (management key)`,
      },
      { status: 200, headers: NO_STORE },
    )
  }

  const rl = await rateLimit("mcp_broker", clientIp(req), 240, 60)
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60), ...NO_STORE } },
    )
  }

  const apiKey = agentKeyFromMcpRequest(req)
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing agent API key. Send x-api-key: pxy_... or Authorization: Bearer pxy_..." },
      { status: 401, headers: NO_STORE },
    )
  }
  const { agent, error } = await authenticateAgent(new NextRequest(req.url, { headers: { "x-api-key": apiKey } }))
  if (!agent) {
    return NextResponse.json({ error: error ?? "Invalid API key" }, { status: 401, headers: NO_STORE })
  }

  const upstream = await loadUpstream(agent.walletId, upstreamName)
  if (!upstream) {
    return NextResponse.json(
      {
        error: `No MCP upstream named '${upstreamName}' is registered on this wallet. The owner registers one with POST /api/v1/broker/upstreams.`,
      },
      { status: 404, headers: NO_STORE },
    )
  }

  const rawBody = req.method === "GET" || req.method === "DELETE" ? undefined : await req.text()

  // Non-POST (SSE resume GET, session DELETE) carries no tools/call — forward.
  if (rawBody === undefined) {
    const res = await forwardToUpstream(upstream, { method: req.method, headers: req.headers, rawBody })
    return passthrough(res)
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return jsonRpcError(null, -32700, "Parse error", 400)
  }

  const call = classifyBrokerBody(body)
  if (call.kind === "invalid") return jsonRpcError(null, -32600, call.reason, 400)

  if (call.kind === "tools_call") {
    // THE interception: the same enforcement shell as POST /v1/authorize/tool.
    const decisionRes = await authorizeToolPOST(
      new NextRequest("https://broker.internal/api/v1/authorize/tool", {
        method: "POST",
        headers: { "x-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          tool: call.tool,
          server: upstreamName,
          ...(call.args ? { arguments: call.args } : {}),
          ...(call.grantId ? { grant_id: call.grantId } : {}),
        }),
      }),
    )
    const decision = (await decisionRes.json()) as {
      authorized?: boolean
      status?: string
      code?: string
      reason?: string
      remediation?: string
      request_id?: string
      error?: string
    }
    if (!decision.authorized) {
      if (decisionRes.status === 401) {
        return NextResponse.json({ error: decision.error ?? "Invalid API key" }, { status: 401, headers: NO_STORE })
      }
      log.info("broker refused tools/call", {
        agentId: agent.id,
        upstream: upstreamName,
        tool: call.tool,
        status: decision.status,
        code: decision.code,
      })
      return NextResponse.json(
        brokerRefusalResult(call.id, {
          status: decision.status ?? "denied",
          code: decision.code,
          reason: decision.reason ?? decision.error,
          remediation: decision.remediation,
          request_id: decision.request_id,
        }),
        { status: 200, headers: NO_STORE },
      )
    }
    // Authorized (allowed, grant consumed, or observe mode): strip the grant
    // meta before forwarding — it is Sanction's, not the upstream's.
    if (call.grantId) {
      const msg = body as { params?: { _meta?: Record<string, unknown> } }
      if (msg.params?._meta) {
        delete msg.params._meta[GRANT_META_KEY]
        if (Object.keys(msg.params._meta).length === 0) delete msg.params._meta
      }
    }
    const res = await forwardToUpstream(upstream, {
      method: req.method,
      headers: req.headers,
      rawBody: JSON.stringify(body),
    })
    return passthrough(res)
  }

  const res = await forwardToUpstream(upstream, { method: req.method, headers: req.headers, rawBody })
  return passthrough(res)
}

function passthrough(res: Response): Response {
  const headers = new Headers()
  for (const h of ["content-type", "mcp-session-id", "mcp-protocol-version"]) {
    const v = res.headers.get(h)
    if (v) headers.set(h, v)
  }
  headers.set("Cache-Control", "no-store")
  return new Response(res.body, { status: res.status, headers })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ upstream: string }> }) {
  return handle(req, ctx)
}
export async function GET(req: NextRequest, ctx: { params: Promise<{ upstream: string }> }) {
  return handle(req, ctx)
}
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ upstream: string }> }) {
  return handle(req, ctx)
}
