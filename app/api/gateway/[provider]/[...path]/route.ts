import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { hashApiKey } from "@/lib/apiKey"
import { GATEWAY_PROVIDERS, isBudgetExhausted, meterUsage } from "@/lib/gateway"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Headers we must not forward upstream (Sanction auth, hop-by-hop, encoding).
const STRIP_REQ = new Set(["host", "x-sanction-key", "content-length", "accept-encoding", "connection"])
// Response headers we re-derive (body was decoded by fetch).
const STRIP_RES = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"])

async function authAgent(req: NextRequest) {
  const key = req.headers.get("x-sanction-key")
  if (!key) return null
  const agent = await db.agent.findUnique({
    where: { apiKeyHash: hashApiKey(key) },
    include: { wallet: { include: { policy: true } } },
  })
  if (!agent || !agent.isActive) return null
  return agent
}

function upstreamHeaders(req: NextRequest): Headers {
  const h = new Headers()
  req.headers.forEach((v, k) => {
    if (!STRIP_REQ.has(k.toLowerCase())) h.set(k, v)
  })
  return h
}

function passthroughResponse(upstream: Response, body: BodyInit | null): Response {
  const h = new Headers()
  upstream.headers.forEach((v, k) => {
    if (!STRIP_RES.has(k.toLowerCase())) h.set(k, v)
  })
  return new Response(body, { status: upstream.status, headers: h })
}

async function handle(req: NextRequest, ctx: { params: Promise<{ provider: string; path?: string[] }> }) {
  const { provider, path = [] } = await ctx.params
  const cfg = GATEWAY_PROVIDERS[provider]
  if (!cfg) return NextResponse.json({ error: `Unknown gateway provider '${provider}'` }, { status: 404 })

  const agent = await authAgent(req)
  if (!agent) return NextResponse.json({ error: "Missing or invalid x-sanction-key" }, { status: 401 })

  // Enforce the daily token budget before the call: if exhausted, don't spend.
  const { exhausted, spent, budget } = await isBudgetExhausted(agent)
  if (exhausted) {
    return NextResponse.json(
      { error: "Daily token budget exhausted", daily_limit_usd: budget, daily_spent_usd: spent },
      { status: 402 },
    )
  }

  const url = `${cfg.baseUrl}/${path.join("/")}${req.nextUrl.search}`
  const method = req.method
  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer()

  let upstream: Response
  try {
    upstream = await fetch(url, { method, headers: upstreamHeaders(req), body })
  } catch {
    return NextResponse.json({ error: "Upstream provider unreachable" }, { status: 502 })
  }

  const ct = upstream.headers.get("content-type") ?? ""

  // JSON response → read, meter, return. (Streaming responses pass through unmetered for now.)
  if (ct.includes("application/json")) {
    const buf = await upstream.arrayBuffer()
    try {
      const json = JSON.parse(new TextDecoder().decode(buf))
      const usage = cfg.extract(json, path.join("/"))
      if (usage && (usage.tokensIn || usage.tokensOut)) await meterUsage(agent.id, provider, usage)
    } catch {
      // not parseable / no usage — pass the body through untouched
    }
    return passthroughResponse(upstream, buf)
  }

  return passthroughResponse(upstream, upstream.body)
}

export const POST = handle
export const GET = handle
