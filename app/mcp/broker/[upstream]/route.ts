import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "@/lib/auth"
import { agentKeyFromMcpRequest, isBrowserMcpProbe } from "@/lib/mcpRemote"
import { publicOrigin } from "@/lib/authzen"
import { clientIp, rateLimit } from "@/lib/rateLimit"
import { brokerRefusalResult, classifyBrokerBody, forwardToUpstream, loadUpstream, GRANT_META_KEY, type UpstreamConfig } from "@/lib/broker"
import {
  LIST_ACTION,
  buildFilteredListResponse,
  failClosedEmptyList,
  filterToolsList,
  listFilterDetails,
  listFilterNote,
  parseToolsListResult,
  parseUpstreamJsonRpc,
  type ListFilterActor,
  type ListFilterResult,
} from "@/lib/brokerListFilter"
import { POST as authorizeToolPOST } from "@/app/api/v1/authorize/tool/route"
import { POST as authorizeSpendPOST } from "@/app/api/v1/authorize/route"
import { gateX402Response, type SpendAuthorizer } from "@/lib/x402Gate"
import { policyLayerChain, decideToolLayered } from "@/lib/inheritance"
import { walletFreezeState, frozenNote } from "@/lib/freeze"
import { db } from "@/lib/db"
import { logger } from "@/lib/log"

export const maxDuration = 60

const log = logger("mcp/broker")
const NO_STORE = { "Cache-Control": "no-store" } as const

// BROKER-1 + BROKER-2: /mcp/broker/{upstream} — the host configures THIS URL
// instead of the upstream MCP server. Every tools/call is authorized through
// the same shell as POST /v1/authorize/tool BEFORE anything reaches the
// upstream. tools/list is forwarded, then filtered fail-closed through the
// same layered tool ladder; unlisted/blocked tools are withheld and every
// allow/deny writes a who/what/why/when receipt. Other MCP traffic
// (initialize, resources, ping) still forwards.
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
    return gateOrPassthrough(res, apiKey, { upstream: upstreamName, agentId: agent.id, rpcId: null })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return jsonRpcError(null, -32700, "Parse error", 400)
  }

  const call = classifyBrokerBody(body)
  if (call.kind === "invalid") return jsonRpcError(null, -32600, call.reason, 400)

  if (call.kind === "tools_list") {
    return handleToolsList(req, {
      agent,
      apiKey,
      upstream,
      upstreamName,
      rpcId: call.id,
      rawBody,
    })
  }

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
    try {
      const res = await forwardToUpstream(upstream, {
        method: req.method,
        headers: req.headers,
        rawBody: JSON.stringify(body),
      })
      return await gateOrPassthrough(res, apiKey, { upstream: upstreamName, agentId: agent.id, rpcId: call.id })
    } catch {
      // A timeout does not prove the upstream did nothing. The grant remains
      // consumed; do not advise a blind retry of a possibly completed action.
      return NextResponse.json(brokerRefusalResult(call.id, {
        status: "unknown", code: "TOOL_EXECUTION_OUTCOME_UNKNOWN",
        reason: "The upstream outcome is unknown. Check the target system before requesting another attempt. A consumed grant cannot be reused.",
        request_id: decision.request_id,
      }), { headers: NO_STORE })
    }
  }

  const res = await forwardToUpstream(upstream, { method: req.method, headers: req.headers, rawBody })
  return gateOrPassthrough(res, apiKey, { upstream: upstreamName, agentId: agent.id, rpcId: null })
}

type BrokerAgent = {
  id: string
  name: string
  walletId: string
  wallet: {
    id: string
    parentId: string | null
    policy: {
      currentRevision: number
      blockedTools: string[]
      allowedTools: string[]
      escalateTools: string[]
      capabilityRules: unknown
      toolConditions?: unknown
      enforcementMode?: string
    } | null
  }
}

// BROKER-2: forward tools/list, then filter through the same layered ladder
// as tools/call. Unparseable / frozen / no-policy fail closed (empty tools,
// never an unfiltered pass-through). x402 402s still hit the spend gate.
async function handleToolsList(
  req: NextRequest,
  ctx: {
    agent: BrokerAgent
    apiKey: string
    upstream: UpstreamConfig
    upstreamName: string
    rpcId: string | number | null
    rawBody: string
  },
): Promise<Response> {
  const who: ListFilterActor = { agent_id: ctx.agent.id, agent: ctx.agent.name, wallet_id: ctx.agent.walletId }
  const when = new Date().toISOString()

  const refuse = async (code: string, reason: string): Promise<Response> => {
    const empty = failClosedEmptyList({ who, upstream: ctx.upstreamName, when, id: ctx.rpcId, code, reason })
    const requestId = await persistListFilter(ctx.agent, ctx.upstreamName, empty.result, false)
    return NextResponse.json(buildFilteredListResponse(ctx.rpcId, {}, empty.result, requestId), { status: 200, headers: NO_STORE })
  }

  const freeze = await walletFreezeState(db, ctx.agent.walletId)
  if (freeze.frozen) return refuse("WALLET_FROZEN", frozenNote(freeze))
  const policy = ctx.agent.wallet.policy
  if (!policy) return refuse("NO_POLICY", "No policy configured")

  let res: Response
  try {
    res = await forwardToUpstream(ctx.upstream, { method: req.method, headers: req.headers, rawBody: ctx.rawBody })
  } catch {
    return refuse("TOOL_LIST_UPSTREAM_UNREACHABLE", "The upstream tools/list could not be retrieved; withheld fail-closed")
  }

  if (res.status === 402) {
    return gateOrPassthrough(res, ctx.apiKey, { upstream: ctx.upstreamName, agentId: ctx.agent.id, rpcId: ctx.rpcId })
  }

  const parsed = parseToolsListResult(parseUpstreamJsonRpc(await res.text(), res.headers.get("content-type")))
  if (!parsed) {
    return refuse("TOOL_LIST_UNPARSEABLE", "Upstream tools/list was not a JSON-RPC result with a tools array; withheld fail-closed")
  }

  const observe = policy.enforcementMode === "observe"
  const layers = await policyLayerChain(db, { id: ctx.agent.wallet.id, parentId: ctx.agent.wallet.parentId, policy })
  const needsCallCount = layers.some((l) => l.toolConditions.some((r) => r.when.after_model_calls_today !== undefined))
  const signalDayStart = new Date()
  signalDayStart.setHours(0, 0, 0, 0)
  const signals = {
    requestHourUtc: new Date().getUTCHours(),
    modelCallsToday: needsCallCount
      ? await db.tokenLog.count({ where: { agentId: ctx.agent.id, createdAt: { gte: signalDayStart } } })
      : undefined,
  }
  const filtered = filterToolsList(parsed.tools, {
    who,
    upstream: ctx.upstreamName,
    when,
    observe,
    decide: (tool) => {
      const outcome = decideToolLayered(tool, layers, signals)
      return { effect: outcome.effect, code: outcome.code, reason: outcome.reason }
    },
  })

  const requestId = await persistListFilter(ctx.agent, ctx.upstreamName, filtered, observe)
  log.info("broker filtered tools/list", {
    agentId: ctx.agent.id,
    upstream: ctx.upstreamName,
    listed: filtered.listed.length,
    withheld: filtered.withheld.length,
    requestId,
  })

  const headers = new Headers({ "content-type": "application/json", "Cache-Control": "no-store" })
  for (const h of ["mcp-session-id", "mcp-protocol-version"]) {
    const v = res.headers.get(h)
    if (v) headers.set(h, v)
  }
  if (requestId) headers.set("x-sanction-request-id", requestId)
  return new Response(JSON.stringify(buildFilteredListResponse(parsed.id ?? ctx.rpcId, parsed.rest, filtered, requestId)), {
    status: 200,
    headers,
  })
}

async function persistListFilter(
  agent: BrokerAgent,
  upstream: string,
  filtered: ListFilterResult,
  observe: boolean,
): Promise<string | undefined> {
  try {
    const row = await db.authorizationRequest.create({
      data: {
        agentId: agent.id,
        kind: "tool",
        action: LIST_ACTION,
        amountUsd: 0,
        merchant: upstream,
        category: "tool",
        detailsJson: listFilterDetails({ upstream, observe, filtered }),
        status: filtered.withheld.length > 0 && !observe ? "denied" : "approved",
        decidedAt: new Date(),
        decisionNote: listFilterNote(filtered),
        policyRevision: agent.wallet.policy?.currentRevision ?? null,
      },
    })
    return row.id
  } catch (err) {
    log.warn("list-filter receipt persist failed", { err: String(err) })
    return undefined
  }
}

// STABLE-1: a brokered upstream that answers 402 is demanding money. Price the
// x402 challenge and run it through the SAME spend ladder as any purchase; on
// anything but an approval the challenge is WITHHELD — the agent cannot sign a
// payment it never received. Non-x402 402s pass through untouched.
async function gateOrPassthrough(
  res: Response,
  apiKey: string,
  ctx: { upstream: string; agentId: string; rpcId: string | number | null },
): Promise<Response> {
  if (res.status !== 402) return passthrough(res)

  const authorize: SpendAuthorizer = async (input) => {
    const r = await authorizeSpendPOST(
      new NextRequest("https://broker.internal/api/v1/authorize", {
        method: "POST",
        headers: { "x-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          action: "purchase",
          amount_usd: input.amountUsd,
          merchant: input.merchant,
          category: input.category,
          description: input.description,
          settlement: input.settlement,
        }),
      }),
    )
    return { ...((await r.json()) as Record<string, unknown>), httpStatus: r.status }
  }

  const verdict = await gateX402Response(res, authorize, { description: `x402 quote from MCP upstream '${ctx.upstream}'` })

  if (verdict.effect === "refuse") {
    log.info("broker withheld an x402 challenge", {
      agentId: ctx.agentId,
      upstream: ctx.upstream,
      status: verdict.status,
      code: verdict.code,
    })
    // The challenge is deliberately absent from this body.
    return NextResponse.json(
      brokerRefusalResult(ctx.rpcId, {
        status: verdict.status,
        code: verdict.code,
        reason: verdict.reason,
        remediation: verdict.remediation,
        request_id: verdict.requestId,
      }),
      { status: 200, headers: NO_STORE },
    )
  }

  const headers = new Headers()
  for (const h of ["content-type", "mcp-session-id", "mcp-protocol-version"]) {
    const v = res.headers.get(h)
    if (v) headers.set(h, v)
  }
  headers.set("Cache-Control", "no-store")
  if (verdict.effect === "allow" && verdict.requestId) headers.set("x-sanction-request-id", verdict.requestId)
  return new Response(verdict.rawBody, { status: 402, headers })
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
