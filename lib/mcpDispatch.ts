import { NextRequest } from "next/server"
import { authenticateAgent } from "./auth"
import { bindInternalAgentIdentity, type InternalAgentIdentity } from "./internalAgentAuth"
import type { SanctionMcpApiCall, SanctionMcpToolProfile } from "./mcpServer"
import { logger } from "./log"
import { extractTraceContext, traceHeaders, type TraceContext } from "./traceContext"
import { POST as authorize } from "@/app/api/v1/authorize/route"
import { POST as provision } from "@/app/api/v1/authorize/provision/route"
import { POST as tool } from "@/app/api/v1/authorize/tool/route"
import { POST as capability } from "@/app/api/v1/authorize/capability/route"
import { POST as tokens } from "@/app/api/v1/tokens/route"
import { POST as outcomes } from "@/app/api/v1/outcomes/route"
import { GET as stats } from "@/app/api/v1/wallets/stats/route"
import { GET as authorization } from "@/app/api/v1/authorize/[id]/route"
import { POST as execution } from "@/app/api/v1/exec/route"
import { POST as inject } from "@/app/api/v1/credentials/inject/route"

const approvalPosts = new Map<string, (request: NextRequest) => Promise<Response>>([
  ["/authorize", authorize],
  ["/authorize/provision", provision],
  ["/authorize/tool", tool],
  ["/authorize/capability", capability],
  ["/tokens", tokens],
  ["/outcomes", outcomes],
])

type Caller =
  | { identity: InternalAgentIdentity }
  | { apiKey: string; origin: string; walletId: string; profile: SanctionMcpToolProfile }

export async function dispatchMcpCall(
  caller: Caller,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  bearerToken?: string,
  trace?: TraceContext,
): Promise<Response> {
  const profile = "identity" in caller ? "approvals" : caller.profile
  const walletId = "identity" in caller ? caller.identity.walletId : caller.walletId
  let handler: ((request: NextRequest) => Promise<Response>) | undefined
  let requestPath = path
  if (method === "POST") {
    handler = approvalPosts.get(path)
    if (profile === "wallet") {
      if (path === "/exec") handler = execution
      if (path === "/credentials/inject") handler = inject
    }
  }
  if (method === "GET") {
    if (/^\/wallets\/stats(?:\?[^#]*)?$/.test(path)) {
      // Drop all caller query options, including duplicate wallet and scope keys.
      requestPath = `/wallets/stats?wallet_id=${encodeURIComponent(walletId)}`
      handler = stats
    } else {
      const match = /^\/authorize\/([A-Za-z0-9_-]+)$/.exec(path)
      if (match && !approvalPosts.has(path)) handler = (req) => authorization(req, { params: Promise.resolve({ id: match[1] }) })
    }
  }
  if (!handler) return Response.json({
    authorized: false, status: "denied",
    code: profile === "approvals" ? "MCP_APPROVAL_ROUTE_NOT_ALLOWED" : "MCP_WALLET_ROUTE_NOT_ALLOWED",
    error: profile === "approvals"
      ? "Route is not available through the approval MCP profile"
      : "Route is not available through the wallet MCP profile",
  }, { status: 403 })

  const headers = new Headers({ "content-type": "application/json", ...traceHeaders(extractTraceContext(trace)) })
  if (bearerToken) headers.set("authorization", `Bearer ${bearerToken}`)
  if ("apiKey" in caller) headers.set("x-api-key", caller.apiKey)
  const origin = "identity" in caller ? "https://sanction.internal" : caller.origin
  const request = new NextRequest(`${origin}/api/v1${requestPath}`, {
    method, headers, ...(method === "POST" && body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  if ("identity" in caller) {
    bindInternalAgentIdentity(request, caller.identity)
    const { agent, error } = await authenticateAgent(request)
    if (!agent) return Response.json({ authorized: false, status: "denied", code: "UNAUTHORIZED", error }, { status: 401 })
    return handler(request)
  }

  // Key clients retain each REST handler's authentication, including the locked
  // key-hash check in /exec. Keep unexpected server errors behind the API boundary.
  try {
    return await handler(request)
  } catch {
    logger("mcp").error("API handler failed", { method, path: request.nextUrl.pathname })
    return new Response(null, { status: 500 })
  }
}

/** OAuth connections are limited to the approval profile and never carry a raw key. */
export async function dispatchMcpApprovalCall(
  identity: InternalAgentIdentity,
  ...args: Parameters<SanctionMcpApiCall>
): Promise<Record<string, unknown>> {
  return (await dispatchMcpCall({ identity }, ...args)).json()
}
