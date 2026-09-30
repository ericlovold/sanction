# Connect a host with OAuth

Implementation status (2026-09-30): available behind `SANCTION_MCP_OAUTH_ENABLED=true`; disabled by default. Verified with a local browser, a synthetic MCP client and isolated Postgres. Named-host compatibility and production rollout are not yet verified.

## User flow

1. Add Sanction's `/mcp/approvals` URL in a host that supports OAuth authorization code with S256 PKCE and dynamic client registration.
2. Sign in with a verified Google, GitHub or configured Apple account. Management-key login does not establish the human OAuth identity.
3. Select an active agent in the wallet you administer and confirm access. The host receives an OAuth token, never the agent key.
4. Manage or disconnect hosts at `/connect/mcp`. Disconnection rejects subsequent requests immediately; already admitted work and completed decisions are not rolled back.

The connection exposes the eight approval-profile tools. It cannot issue execution tokens or retrieve vault credentials. Hosted wallet MCP remains cooperative: the host must ask before acting. This does not automatically govern the host's other tools.

## Rollout

Apply the additive `20260930170000_mcp_oauth_provider` migration before enabling the feature. It adds the provider's JWT/OAuth tables and `McpOAuthConnection`; it does not modify existing wallet or agent data.

Set a stable `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET`, configure the existing social sign-in providers, then set `SANCTION_MCP_OAUTH_ENABLED=true`. Use HTTPS in production. HTTP loopback is supported for local testing. The canonical resource is the configured origin plus `/mcp/approvals`; request Host headers cannot change it. Set the flag back to false to disable OAuth while retaining agent-key connections.

Discovery is forwarded to Better Auth at `/.well-known/oauth-authorization-server/api/auth`, `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp/approvals`. The API auth handler serves authorization, token, registration and JWKS endpoints under `/api/auth`. Unauthenticated OAuth MCP requests receive the provider's discovery challenge.

Do not advertise a marketplace listing until a real host completes installation, consent, a governed request and disconnect against the deployed endpoint. The rollout also needs a review of remaining tool output, including the grant flow.

## Authorization boundaries

- Better Auth's pinned MCP/OAuth provider handles PKCE, signed consent queries, exact registered redirects, authorization codes, refresh and JWT verification. Client credentials grants are disabled. Generic session JWT issuance at `/api/auth/token` is disabled while MCP OAuth is enabled.
- Each consent creates a new immutable connection binding the human, client, wallet and agent. The provider carries its ID from the code into the refresh family. Reconnecting to another agent cannot redirect an older connection's authority.
- Every MCP request verifies issuer, audience, expiry and `sanction:approvals`, then checks the connection's client/user binding and revocation, current wallet ownership/admin membership, and active, unexpired agent. The agent's existing policy still controls decisions.
- OAuth calls dispatch only to an explicit list of existing approval API handlers in-process. A WeakMap binds trusted identity to the exact internal request; HTTP headers cannot create this binding. No OAuth token is forwarded as an API key. The handlers recheck agent state and apply their existing policy, budget and grant rules.
- `offline_access` permits refresh. Connection revocation blocks resource use immediately and fresh token issuance. The provider's short refresh-retry window may return an already cached token response; it does not restore a revoked connection's access.
- Existing `pxy_` clients keep their current permissions. Key rotation is separate from OAuth disconnection; deactivate the agent or disconnect a host to stop its OAuth access. The full `/mcp`, broker, REST and vault endpoints do not accept these OAuth tokens.

## Evidence

`tests/mcp-oauth.db.test.ts` drives the real provider and database with external HTTP blocked. The unit suites `mcpOAuthConsent`, `mcpOAuthAccess`, `mcpOAuthRemote` and `mcpApprovalDispatch` cover the application boundaries and forged identity inputs.

Local browser testing exercised consent, code exchange, the eight-tool list, budget status, synthetic tool escalation, owner approval, single-use redemption, replay denial, excluded-tool denial, wrong-endpoint denial and disconnect. No external target action was executed. Social-provider login itself was represented by a seeded local Better Auth session; live provider login and named-host acceptance remain rollout checks.
