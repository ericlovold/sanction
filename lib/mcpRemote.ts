import { NextRequest, NextResponse } from "next/server"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { authenticateAgent } from "./auth"
import { publicOrigin } from "./authzen"
import { createSanctionMcpServer } from "./mcpServer"
import { clientIp, rateLimit } from "./rateLimit"

const NO_STORE = { "Cache-Control": "no-store" } as const
const MCP_ACCEPT = "application/json, text/event-stream"

/** Agent key from x-api-key or Authorization: Bearer pxy_... Management keys are refused. */
export function agentKeyFromMcpRequest(req: Request): string | null {
  const header = req.headers.get("x-api-key")?.trim()
  if (header) return header.startsWith("pxy_") ? header : null
  const auth = req.headers.get("authorization")
  if (!auth) return null
  const match = /^Bearer\s+(\S+)/i.exec(auth)
  const token = match?.[1]
  if (!token || !token.startsWith("pxy_")) return null
  return token
}

function authRequest(url: string, apiKey: string): NextRequest {
  return new NextRequest(url, { headers: { "x-api-key": apiKey } })
}

/**
 * Hosted wallet endpoint. Stateless Streamable HTTP, JSON responses (no hanging
 * SSE — Vercel functions must return). Still cooperative: same ten tools as
 * stdio. Broker interception of tools/call is v1.1.
 */
export async function handleSanctionMcpRequest(req: NextRequest): Promise<Response> {
  const rl = await rateLimit("mcp_hosted", clientIp(req), 120, 60)
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

  const { agent, error } = await authenticateAgent(authRequest(req.url, apiKey))
  if (!agent) {
    return NextResponse.json({ error: error ?? "Invalid API key" }, { status: 401, headers: NO_STORE })
  }

  const origin = publicOrigin(req)
  const server = createSanctionMcpServer({
    apiKey,
    apiUrl: `${origin}/api/v1`,
    walletId: agent.walletId,
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  try {
    const incoming = req.headers.get("accept")?.includes("text/event-stream")
      ? req
      : new Request(req.url, {
          method: req.method,
          headers: withAccept(req.headers),
          body: req.method === "GET" || req.method === "DELETE" ? undefined : await req.text(),
        })
    const res = await transport.handleRequest(incoming)
    const headers = new Headers(res.headers)
    headers.set("Cache-Control", "no-store")
    return new Response(res.body, { status: res.status, headers })
  } finally {
    await transport.close()
    await server.close()
  }
}

function withAccept(headers: Headers): Headers {
  const next = new Headers(headers)
  const accept = next.get("accept") ?? ""
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    next.set("accept", MCP_ACCEPT)
  }
  return next
}
