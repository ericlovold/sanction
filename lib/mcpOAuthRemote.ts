import { NextRequest } from "next/server"
import { requireMcpAuth } from "@better-auth/mcp"
import { auth } from "./auth-config"
import { mcpOAuthResource, MCP_APPROVALS_SCOPE } from "./mcpOAuthProvider"
import { mcpConnectionIdentity } from "./mcpOAuthAccess"
import { handleAuthenticatedMcpRequest } from "./mcpRemote"
import { dispatchMcpApprovalCall } from "./mcpApprovalDispatch"
import { clientIp, rateLimit } from "./rateLimit"

export async function handleOAuthMcpRequest(req: NextRequest): Promise<Response> {
  const limited = await rateLimit("mcp_hosted", clientIp(req), 120, 60)
  if (!limited.ok) return Response.json({ error: "Too many requests" }, {
    status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(limited.retryAfter ?? 60) },
  })
  const resource = mcpOAuthResource()
  const protectedHandler = requireMcpAuth(auth, async (request, claims) => {
    const identity = await mcpConnectionIdentity(claims)
    if (!identity) return Response.json({ error: "Connection revoked or no longer authorized" }, {
      status: 401, headers: { "Cache-Control": "no-store", "WWW-Authenticate": 'Bearer error="invalid_token"' },
    })
    return handleAuthenticatedMcpRequest(new NextRequest(request), {
      apiKey: "", apiUrl: new URL("/api/v1", resource).toString(),
      walletId: identity.walletId, toolProfile: "approvals",
      apiCall: (...args) => dispatchMcpApprovalCall(identity, ...args),
    })
  }, { resource, requiredScopes: [MCP_APPROVALS_SCOPE] })
  const response = await protectedHandler(req)
  response.headers.set("Cache-Control", "no-store")
  return response
}
