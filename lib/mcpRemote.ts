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

/**
 * A browser GET has no agent key. MCP clients send `text/event-stream` (and
 * POST initialize). Humans who click the published URL should see how to paste
 * it, not a raw 401.
 */
export function isBrowserMcpProbe(req: Request): boolean {
  if (req.method !== "GET") return false
  if (agentKeyFromMcpRequest(req)) return false
  const accept = req.headers.get("accept") ?? ""
  if (accept.includes("text/event-stream")) return false
  return accept.includes("text/html")
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")
}

export function mcpLandingHtml(origin: string): string {
  const url = `${origin}/mcp`
  const safe = escapeHtml(url)
  const config = escapeHtml(
    JSON.stringify(
      {
        mcpServers: {
          sanction: {
            url,
            headers: { "x-api-key": "pxy_YOUR_AGENT_KEY" },
          },
        },
      },
      null,
      2,
    ),
  )
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sanction — agent wallet</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; min-height: 100dvh; background: #09090b; color: #e4e4e7;
      font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; }
    main { max-width: 40rem; margin: 0 auto; padding: 4rem 1.5rem; }
    .kicker { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #a1a1aa; }
    h1 { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; margin: 0.5rem 0 1rem; }
    p { color: #a1a1aa; }
    pre { background: #18181b; border: 1px solid #27272a; padding: 1rem; overflow: auto;
      font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; color: #fafafa; }
    a { color: #c4a574; }
    .note { font-size: 0.875rem; color: #71717a; }
  </style>
</head>
<body>
  <main>
    <p class="kicker">Agent wallet</p>
    <h1>This is the wallet an agent carries.</h1>
    <p>This is a Streamable HTTP wallet endpoint. MCP hosts send your agent key (<code>x-api-key: pxy_…</code> or <code>Authorization: Bearer pxy_…</code>). A browser has no key, so the protocol fail-closes.</p>
    <pre>${config}</pre>
    <p class="note">This wallet URL is cooperative — the host must ask before acting. For intercepted tools/call, front your MCP servers with the broker (<code>/mcp/broker/&lt;upstream&gt;</code>). Discovery: <a href="${escapeHtml(origin)}/.well-known/wallet-card.json">Wallet Card</a>. Need a key? <a href="${escapeHtml(origin)}/start">Create a wallet</a>.</p>
    <p class="note"><code>${safe}</code></p>
  </main>
</body>
</html>`
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
  if (isBrowserMcpProbe(req)) {
    const html = mcpLandingHtml(publicOrigin(req))
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
    })
  }

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
