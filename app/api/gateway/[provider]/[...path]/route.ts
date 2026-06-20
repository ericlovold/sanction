import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { hashApiKey } from "@/lib/apiKey"
import { GATEWAY_PROVIDERS, isBudgetExhausted, meterUsage, makeStreamMeter } from "@/lib/gateway"

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
  // Proxied LLM responses are per-request and must never be cached at the edge.
  h.set("cache-control", "no-store")
  return new Response(body, { status: upstream.status, headers: h })
}

async function handle(req: NextRequest, ctx: { params: Promise<{ provider: string; path?: string[] }> }) {
  const { provider, path = [] } = await ctx.params
  const noStore = { "cache-control": "no-store" }
  const cfg = GATEWAY_PROVIDERS[provider]
  if (!cfg) return NextResponse.json({ error: `Unknown gateway provider '${provider}'` }, { status: 404, headers: noStore })

  const agent = await authAgent(req)
  if (!agent) return NextResponse.json({ error: "Missing or invalid x-sanction-key" }, { status: 401, headers: noStore })

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

  // Streaming (SSE) → tee bytes straight through to the client, parse `data:`
  // events as they pass, and meter the accumulated usage when the stream ends.
  if (ct.includes("text/event-stream") && upstream.body) {
    const meter = makeStreamMeter(provider)
    const decoder = new TextDecoder()
    let buf = ""
    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk)
        buf += decoder.decode(chunk, { stream: true })
        let nl: number
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (line.startsWith("data:")) {
            const payload = line.slice(5).trim()
            if (payload && payload !== "[DONE]") {
              try {
                meter.feed(JSON.parse(payload))
              } catch {
                // partial/non-JSON event line — ignore
              }
            }
          }
        }
      },
      async flush() {
        const u = meter.result()
        if (u.tokensIn || u.tokensOut) {
          try {
            await meterUsage(agent.id, provider, u)
          } catch {
            // metering failure must not break the client's stream
          }
        }
      },
    })
    return passthroughResponse(upstream, upstream.body.pipeThrough(transform))
  }

  // JSON response → read, meter, return.
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

// Next detects route methods by static named-export analysis; declaring them as
// functions (not `export const POST = handle`) is required for the route to register.
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string; path?: string[] }> }) {
  return handle(req, ctx)
}
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string; path?: string[] }> }) {
  return handle(req, ctx)
}
