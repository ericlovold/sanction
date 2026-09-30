import { mcp } from "@better-auth/mcp"
import { jwt } from "better-auth/plugins"
import { APIError } from "better-auth/api"
import { db } from "./db"
import { mcpOAuthConsentContext } from "./mcpOAuthContext"

export const MCP_APPROVALS_SCOPE = "sanction:approvals"

export function mcpOAuthEnabled(): boolean {
  return process.env.SANCTION_MCP_OAUTH_ENABLED === "true"
}

export function mcpOAuthResource(): string {
  const configured = process.env.BETTER_AUTH_URL
  if (!configured) throw new Error("BETTER_AUTH_URL is required for MCP OAuth")
  const url = new URL(configured)
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new Error("MCP OAuth requires a canonical HTTPS BETTER_AUTH_URL (HTTP loopback is allowed locally)")
  }
  return `${url.origin}/mcp/approvals`
}

export function mcpOAuthPlugins() {
  if (!mcpOAuthEnabled()) return []
  return [
    jwt({ disableSettingJwtHeader: true }),
    mcp({
      loginPage: "/connect/mcp/login",
      consentPage: "/connect/mcp",
      resource: mcpOAuthResource(),
      // Prisma scalar lists cannot store null. The provider's string resource
      // shorthand seeds allowedScopes:null, so supply the explicit policy.
      resources: [{ identifier: mcpOAuthResource(), allowedScopes: [MCP_APPROVALS_SCOPE, "offline_access"] }],
      scopes: [MCP_APPROVALS_SCOPE, "offline_access"],
      grantTypes: ["authorization_code", "refresh_token"],
      accessTokenExpiresIn: 900,
      // Older MCP hosts use DCR. Provider validation owns redirect URI and
      // PKCE checks; clients cannot self-assign skipConsent or requirePKCE.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      postLogin: {
        page: "/connect/mcp",
        shouldRedirect: async ({ user }) => mcpOAuthConsentContext.getStore()?.userId !== user.id,
        consentReferenceId: async ({ user }) => {
          const context = mcpOAuthConsentContext.getStore()
          if (!context || context.userId !== user.id) {
            throw new APIError("FORBIDDEN", { message: "Select an agent through the MCP consent page" })
          }
          return context.connectionId
        },
      },
      customAccessTokenClaims: async ({ user, referenceId, resources, scopes }) => {
        if (!user || !referenceId || !resources?.includes(mcpOAuthResource()) || !scopes.includes(MCP_APPROVALS_SCOPE)) {
          throw new APIError("FORBIDDEN", { message: "MCP authorization is not bound to a connection" })
        }
        const connection = await db.mcpOAuthConnection.findFirst({
          where: { id: referenceId, userId: user.id, revokedAt: null },
        })
        if (!connection) throw new APIError("FORBIDDEN", { message: "MCP connection is unavailable or revoked" })
        // referenceId is copied from authorization code to refresh family by
        // Better Auth. Never resolve a mutable user/client -> agent mapping.
        return { sanction_connection_id: connection.id }
      },
    }),
  ]
}
