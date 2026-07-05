import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { hashApiKey } from "@/lib/apiKey"
import { GATEWAY_PROVIDERS, isBudgetExhausted, meterUsage, makeStreamMeter } from "@/lib/gateway"
import type { GatewayUsage } from "@/lib/gateway"
import { notifyTokenBudgetThreshold } from "@/lib/thresholds"

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
  // Seat expiry fails closed on the gateway too - same rule as lib/auth.ts.
  if (agent.expiresAt && agent.expiresAt <= new Date()) return null
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

function meteringFailure(): Response {
  return NextResponse.json(
    { error: "Sanction metering failed; provider response withheld" },
    { status: 502, headers: { "cache-control": "no-store" } },
  )
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
      { status: 402, headers: noStore },
    )
  }

  const url = `${cfg.baseUrl}/${path.join("/")}${req.nextUrl.search}`
  const method = req.method
  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer()
  const notifyThreshold = async (cost: number) => {
    try {
      await notifyTokenBudgetThreshold({
        walletId: agent.walletId,
        ownerEmail: agent.wallet.ownerEmail,
        agentName: agent.name,
        prevUsd: spent,
        nextUsd: spent + cost,
        budgetUsd: budget,
      })
    } catch {
      // Threshold alerts are best-effort; the usage write above is not.
    }
  }
  const meterObservedUsage = async (usage: GatewayUsage): Promise<boolean> => {
    try {
      const cost = await meterUsage(agent.id, provider, usage)
      await notifyThreshold(cost)
      return true
    } catch {
      return false
    }
  }

  let upstream: Response
  try {
    upstream = await fetch(url, { method, headers: upstreamHeaders(req), body })
  } catch {
    return NextResponse.json({ error: "Upstream provider unreachable" }, { status: 502, headers: noStore })
  }

  const ct = upstream.headers.get("content-type") ?? ""

  // Streaming (SSE) must not reach the client unmetered. Buffer the stream,
  // inspect usage, persist the meter row, then release the original bytes.
  if (ct.includes("text/event-stream") && upstream.body) {
    const meter = makeStreamMeter(provider)
    const text = await upstream.text()
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed.startsWith("data:")) {
        const payload = trimmed.slice(5).trim()
        if (payload && payload !== "[DONE]") {
          try {
            meter.feed(JSON.parse(payload))
          } catch {
            // partial/non-JSON event line - ignore
          }
        }
      }
    }
    const usage = meter.result()
    if ((usage.tokensIn || usage.tokensOut) && !(await meterObservedUsage(usage))) {
      return meteringFailure()
    }
    return passthroughResponse(upstream, text)
  }

  // JSON response -> read, meter, return.
  if (ct.includes("application/json")) {
    const buf = await upstream.arrayBuffer()
    let usage: GatewayUsage | null = null
    try {
      const json = JSON.parse(new TextDecoder().decode(buf))
      usage = cfg.extract(json, path.join("/"))
    } catch {
      // not parseable / no usage - pass the body through untouched
    }
    if (usage && (usage.tokensIn || usage.tokensOut) && !(await meterObservedUsage(usage))) {
      return meteringFailure()
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
