import { NextRequest } from "next/server"
import { agentKeyFromMcpRequest, handleSanctionMcpRequest } from "@/lib/mcpRemote"

import { mcpOAuthEnabled } from "@/lib/mcpOAuthProvider"

export const dynamic = "force-dynamic"
export const maxDuration = 30

// Existing key clients remain compatible. OAuth never falls back to key auth.
async function handle(req: NextRequest) {
  if (!mcpOAuthEnabled() || req.headers.has("x-api-key") || agentKeyFromMcpRequest(req)) {
    return handleSanctionMcpRequest(req, "approvals")
  }
  const { handleOAuthMcpRequest } = await import("@/lib/mcpOAuthRemote")
  return handleOAuthMcpRequest(req)
}
export async function POST(req: NextRequest) {
  return handle(req)
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function DELETE(req: NextRequest) {
  return handle(req)
}
