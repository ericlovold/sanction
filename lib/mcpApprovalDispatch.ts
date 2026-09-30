import { NextRequest } from "next/server"
import { authenticateAgent } from "./auth"
import { bindInternalAgentIdentity, type InternalAgentIdentity } from "./internalAgentAuth"
import { extractTraceContext, traceHeaders, type TraceContext } from "./traceContext"
import { POST as authorize } from "@/app/api/v1/authorize/route"
import { POST as provision } from "@/app/api/v1/authorize/provision/route"
import { POST as tool } from "@/app/api/v1/authorize/tool/route"
import { POST as capability } from "@/app/api/v1/authorize/capability/route"
import { POST as tokens } from "@/app/api/v1/tokens/route"
import { POST as outcomes } from "@/app/api/v1/outcomes/route"
import { GET as stats } from "@/app/api/v1/wallets/stats/route"
import { GET as authorization } from "@/app/api/v1/authorize/[id]/route"

const posts = new Map<string, (request: NextRequest) => Promise<Response>>([
  ["/authorize", authorize],
  ["/authorize/provision", provision],
  ["/authorize/tool", tool],
  ["/authorize/capability", capability],
  ["/tokens", tokens],
  ["/outcomes", outcomes],
])

/** Approval-profile dispatch only. Never reconstruct or forward an agent key. */
export async function dispatchMcpApprovalCall(
  identity: InternalAgentIdentity,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  bearerToken?: string,
  trace: TraceContext = {},
): Promise<Record<string, unknown>> {
  let handler: ((request: NextRequest) => Promise<Response>) | undefined
  let requestPath = path
  if (method === "POST") handler = posts.get(path)
  if (method === "GET") {
    if (/^\/wallets\/stats(?:\?[^#]*)?$/.test(path)) {
      // Drop all caller query options, including duplicate wallet and scope keys.
      requestPath = `/wallets/stats?wallet_id=${encodeURIComponent(identity.walletId)}`
      handler = stats
    } else {
      const match = /^\/authorize\/([A-Za-z0-9_-]+)$/.exec(path)
      if (match && !posts.has(path)) handler = (req) => authorization(req, { params: Promise.resolve({ id: match[1] }) })
    }
  }
  if (!handler) return {
    authorized: false, status: "denied", code: "MCP_APPROVAL_ROUTE_NOT_ALLOWED",
    error: "Route is not available through the approval MCP profile",
  }

  const headers = new Headers({ "content-type": "application/json", ...traceHeaders(extractTraceContext(trace)) })
  // An explicit execution JWT retains its existing budget semantics. The OAuth
  // access token authenticates the outer transport and is never passed here.
  if (bearerToken) headers.set("authorization", `Bearer ${bearerToken}`)
  const request = new NextRequest(`https://sanction.internal/api/v1${requestPath}`, {
    method, headers, ...(method === "POST" && body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  bindInternalAgentIdentity(request, identity)
  const { agent, error } = await authenticateAgent(request)
  if (!agent) return { authorized: false, status: "denied", code: "UNAUTHORIZED", error }
  // The actual route authenticates the same bound request again, enforcing its
  // normal policy, tenant, budget, grant and persistence behavior.
  return (await handler(request)).json()
}
