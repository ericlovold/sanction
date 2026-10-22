import { auth } from "@/lib/auth-config"
import { mcpOAuthEnabled } from "@/lib/mcpOAuthProvider"

export const dynamic = "force-dynamic"
const paths = new Set([
  "/.well-known/oauth-authorization-server/api/auth",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp/approvals",
])
export async function GET(req: Request) {
  const url = new URL(req.url)
  if (!mcpOAuthEnabled() || !paths.has(url.pathname)) return new Response(null, { status: 404 })
  // RFC 8414's path-aware URL is /api/auth. Hosts that probe the origin
  // well-known path still need the same issuer document — Better Auth 404s it.
  const forwarded = url.pathname === "/.well-known/oauth-authorization-server"
    ? new Request(new URL("/.well-known/oauth-authorization-server/api/auth", url.origin), req)
    : req
  const response = await auth.handler(forwarded)
  response.headers.set("Cache-Control", "no-store")
  return response
}
