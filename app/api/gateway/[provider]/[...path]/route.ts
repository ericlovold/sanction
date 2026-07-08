import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { frozenNote, walletFreezeState } from "@/lib/freeze"
import { hashApiKey } from "@/lib/apiKey"
import { GATEWAY_PROVIDERS, isBudgetExhausted, meterUsage, makeStreamMeter } from "@/lib/gateway"
import type { GatewayUsage } from "@/lib/gateway"
import { notifyTokenBudgetThreshold } from "@/lib/thresholds"

export const dynamic = "force-dynamic"
// Streaming responses relay at the provider's pace; give long generations room
// so a live stream is never cut mid-flight (the old buffered path could burn
// tokens then time out at 60s with nothing delivered).
export const maxDuration = 300

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

  // KILL-1: a frozen wallet (or ancestor) pauses the gateway too — metered LLM
  // calls are spend.
  const freeze = await walletFreezeState(db, agent.walletId)
  if (freeze.frozen) {
    return NextResponse.json({ error: frozenNote(freeze), code: "WALLET_FROZEN" }, { status: 403, headers: noStore })
  }

  // Token budget wall before the call: seat daily, seat monthly, then pooled
  // subtree caps up the wallet tree — if any line is spent, don't call out.
  const { exhausted, spent, budget, horizon, capWalletId } = await isBudgetExhausted(agent)
  if (exhausted) {
    const which = horizon ?? "daily"
    const label =
      which === "subtree-daily"
        ? "Pool daily token cap exhausted"
        : which === "monthly"
          ? "Monthly token budget exhausted"
          : "Daily token budget exhausted"
    return NextResponse.json(
      {
        error: label,
        horizon: which,
        limit_usd: budget,
        spent_usd: spent,
        // Back-compat fields for existing integrations (daily wall shape).
        daily_limit_usd: which === "daily" ? budget : undefined,
        daily_spent_usd: which === "daily" ? spent : undefined,
        cap_wallet_id: capWalletId,
      },
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
  // Meter with bounded retries — for the streaming path, where the client has
  // already received the bytes so we can't withhold. The budget gate above
  // already fails closed on a DB outage (the read throws before the provider
  // is ever called), so the only case this covers is a transient write blip
  // after a healthy read. Retries clear that; a hard final failure is logged
  // loudly (a genuine anomaly) and left as a single-call under-count — the
  // honest limit without an external durable queue.
  const meterWithRetry = async (usage: GatewayUsage): Promise<void> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await meterObservedUsage(usage)) return
    }
    console.error("gateway meter write failed after retries — usage uncounted", {
      agentId: agent.id, provider, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut,
    })
  }

  let upstream: Response
  try {
    upstream = await fetch(url, { method, headers: upstreamHeaders(req), body })
  } catch {
    return NextResponse.json({ error: "Upstream provider unreachable" }, { status: 502, headers: noStore })
  }

  const ct = upstream.headers.get("content-type") ?? ""

  // Streaming (SSE) → tee bytes straight through to the client as the provider
  // produces them, parse `data:` events as they pass, and meter the accumulated
  // usage when the stream ends. Live streaming is preserved; metering settles at
  // stream-end with retries. (Withholding a stream we've already begun sending
  // is impossible, and buffering the whole thing first kills streaming and risks
  // a token-burn-then-timeout at maxDuration — that's why the enforcement leans
  // on the pre-call budget gate, which fails closed on a DB outage.)
  if (ct.includes("text/event-stream") && upstream.body) {
    const meter = makeStreamMeter(provider)
    const decoder = new TextDecoder()
    let buf = ""
    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk) // live pass-through — the client sees every token as it lands
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
        const usage = meter.result()
        if (usage.tokensIn || usage.tokensOut) await meterWithRetry(usage)
      },
    })
    return passthroughResponse(upstream, upstream.body.pipeThrough(transform))
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
