"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth-config"
import { db } from "@/lib/db"
import { getSessionMember } from "@/lib/session"
import { hasRole } from "@/lib/roles"
import { mcpOAuthEnabled, mcpOAuthResource, MCP_APPROVALS_SCOPE } from "@/lib/mcpOAuthProvider"
import { mcpOAuthConsentContext } from "@/lib/mcpOAuthContext"

export async function consentMcpConnection(form: FormData): Promise<void> {
  if (!mcpOAuthEnabled()) throw new Error("MCP connections are not enabled")
  const requestHeaders = new Headers(await headers())
  const request = new Request(new URL("/api/auth/oauth2/consent", mcpOAuthResource()), { method: "POST", headers: requestHeaders })
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session?.user.emailVerified) throw new Error("Sign in with a verified account to connect")
  const query = String(form.get("oauth_query") ?? "")
  if (!query || query.length > 16_384) throw new Error("Invalid connection request")
  const params = new URLSearchParams(query)
  const accept = form.get("decision") === "allow"
  let destination: string
  if (!accept) {
    const result = await auth.api.oauth2Consent({ asResponse: false, request, headers: requestHeaders, body: { accept: false, oauth_query: query } })
    destination = result.url
  } else {
    const member = await getSessionMember()
    if (!member || member.actor.type !== "user" || member.actor.userId !== session.user.id || !hasRole(member.role, "admin")) {
      throw new Error("Only a wallet owner or administrator can connect an agent")
    }
    const clientId = params.get("client_id")
    const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean)
    if (!clientId || !scopes.includes(MCP_APPROVALS_SCOPE) || scopes.some(scope => ![MCP_APPROVALS_SCOPE, "offline_access"].includes(scope))) {
      throw new Error("Unsupported connection scope")
    }
    const agent = await db.agent.findFirst({
      where: { id: String(form.get("agent_id") ?? ""), walletId: member.wallet.id, isActive: true },
      select: { id: true, expiresAt: true },
    })
    if (!agent || (agent.expiresAt && agent.expiresAt <= new Date())) throw new Error("Choose an active agent in this wallet")
    const connection = await db.mcpOAuthConnection.create({ data: {
      userId: session.user.id, walletId: member.wallet.id, agentId: agent.id, clientId,
    } })
    try {
      const result = await mcpOAuthConsentContext.run({ connectionId: connection.id, userId: session.user.id }, () =>
        auth.api.oauth2Consent({ asResponse: false, request, headers: requestHeaders, body: { accept: true, oauth_query: query } }),
      )
      destination = result.url
    } catch {
      await db.mcpOAuthConnection.update({ where: { id: connection.id }, data: { revokedAt: new Date() } })
      throw new Error("Connection request could not be verified. Restart connection from your host.")
    }
  }
  // Only the provider's validated redirect is used; never the submitted redirect_uri.
  redirect(destination)
}

export async function revokeMcpConnection(form: FormData): Promise<void> {
  if (!mcpOAuthEnabled()) throw new Error("MCP connections are not enabled")
  const member = await getSessionMember()
  if (!member || !hasRole(member.role, "admin")) throw new Error("Wallet administrator required")
  await db.mcpOAuthConnection.updateMany({
    where: { id: String(form.get("connection_id") ?? ""), walletId: member.wallet.id, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  redirect("/connect/mcp")
}
