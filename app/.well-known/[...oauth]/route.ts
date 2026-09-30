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
  if (!mcpOAuthEnabled() || !paths.has(new URL(req.url).pathname)) return new Response(null, { status: 404 })
  const response = await auth.handler(req)
  response.headers.set("Cache-Control", "no-store")
  return response
}
