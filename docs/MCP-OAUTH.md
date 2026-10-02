# Connect a host with OAuth

Rollout checkpoint (2026-09-30): enabled on getsanction.com after the migration. A custom Claude connector using automatic registration (DCR) completed consent, tool discovery, a budget read, synthetic escalation, operator rejection and revocation. An October 1 follow-up verified explicit one-off tool approval, exact-request redemption, and consumed-grant replay denial in Claude. Fresh social-provider login and automatic token refresh remain unverified. Other deployments default to disabled.

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

The custom-connector smoke is not directory acceptance. Marketplace submission still needs review of remaining tool output, including grants, and the publisher's submission requirements.

## Ask for one approval

Once connected to an agent, ask Sanction for a human decision without editing a
policy. Use the existing `sanction_authorize_tool` with `require_approval: true`.
An initial request cannot override a hard denial. It pauses even in observe mode and can never
auto-approve on timeout. It expires after the wallet's positive timeout, or 60
minutes when the wallet has no timeout; that duration is fixed when requested.

Try this prompt in your connected host:

> Ask Sanction for my approval to run `demo.noop` with arguments
> `{"message":"My first approval"}`. Set `require_approval` to true and
> `approval_reason` to "I want to try a one-off approval." This is a synthetic
> test: make one authorization call, show the request ID, then stop. Do not
> execute any action, retry, or poll automatically.

For your own action, provide its actual tool name, server, and exact arguments.
Put the explanation in `approval_reason`; do not put credentials or secrets in it.
The owner receives the existing email approval link and configured Slack delivery.
Tool arguments are encrypted for authorized review; notification text is not a
complete argument review. Open the review link when you need to inspect them.

After the human decides, check `sanction_check_authorization` once with the
request ID. On `retry_with_grant`, repeat the original tool authorization with
identical tool, server, and arguments, plus the returned `grant_id`. Only an
`authorized: true` redemption permits that attempt. Changed arguments, expired
grants, and grant reuse are refused. Tool grant redemption uses the existing grant
checks; it does not re-evaluate the current tool-policy ladder. A synthetic test should still execute no
external action, even after successful redemption.

This is cooperative: connecting does not intercept the host's other tools.
Omitting `require_approval` uses the standing policy; confidence is never a reason
to bypass a mandatory approval. A connection to a wallet and an agent is still
required. No new MCP tool or additional OAuth scope is needed. The October 1 Claude production smoke verified this one-off flow through redemption and replay denial, with no external action executed. Other hosts remain unverified; connection compatibility alone is not proof of approval resumption. See [host setup and the first-approval prompt](/docs/connect).

## MCP decision results

The four authorization tools and `sanction_check_authorization` return readable text, a second text block containing the decision as JSON, and `structuredContent`. The JSON text block contains the same allowlisted fields as `structuredContent` for hosts that expose only text to the model. A successful MCP call is not permission: hosts must check `authorized` and `next_action`.

| Result | `authorized` | `next_action` | Host behavior |
| --- | --- | --- | --- |
| Authorization succeeds | `true` | `proceed` | Perform only the authorized action. |
| Pending or escalated | `false` | `wait` | Pause; check once after human resolution, or use bounded polling with backoff. |
| Denied | `false` | `stop` | Do not execute or automatically retry. |
| Poll observes an active, unexpired grant | `false` | `retry_with_grant` | Submit the identical original authorization with `grant_id`; execute only if that redemption is authorized. |
| Poll observes unusable or missing authority | `false` | `stop` | Do not reuse a consumed, expired or revoked grant. |
| Authentication, transport or malformed-response failure | `false` | `stop` | Resolve the failure; do not assume permission or blindly replay a possibly processed request. |

Ordinary decisions have `isError: false`, including a refusal. Actual call failures have `isError: true`. Decision fields are allowlisted; available request IDs, codes, reasons and grant state are retained. Only a usable polled grant exposes `grant_id`. An explicit null expiry means non-expiring; missing or invalid expiry does not prove usability. The redemption endpoint remains authoritative if policy or grant state changes after polling.

This response contract also applies to the full wallet and bundled stdio server. It does not change tool permissions, the policy engine or grant consumption. Consumers that treated `isError: false` as permission must use the decision fields instead. A new npm release is needed to distribute the rebuilt bundle.

## Authorization boundaries

- Better Auth's pinned MCP/OAuth provider handles PKCE, signed consent queries, exact registered redirects, authorization codes, refresh and JWT verification. Client credentials grants are disabled. Generic session JWT issuance at `/api/auth/token` is disabled while MCP OAuth is enabled.
- Each consent creates a new immutable connection binding the human, client, wallet and agent. The provider carries its ID from the code into the refresh family. Reconnecting to another agent cannot redirect an older connection's authority.
- Every MCP request verifies issuer, audience, expiry and `sanction:approvals`, then checks the connection's client/user binding and revocation, current wallet ownership/admin membership, and active, unexpired agent. The agent's existing policy still controls decisions.
- OAuth calls dispatch only to an explicit list of existing approval API handlers in-process. A WeakMap binds trusted identity to the exact internal request; HTTP headers cannot create this binding. No OAuth token is forwarded as an API key. The handlers recheck agent state and apply their existing policy, budget and grant rules.
- `offline_access` permits refresh. Connection revocation blocks resource use immediately and fresh token issuance. The provider's short refresh-retry window may return an already cached token response; it does not restore a revoked connection's access.
- Existing `pxy_` clients keep their current permissions. Key rotation is separate from OAuth disconnection; deactivate the agent or disconnect a host to stop its OAuth access. The full `/mcp`, broker, REST and vault endpoints do not accept these OAuth tokens.

## Evidence

`tests/mcp-oauth.db.test.ts` drives the real provider and database with external HTTP blocked. The unit suites `mcpOAuthConsent`, `mcpOAuthAccess`, `mcpOAuthRemote` and `mcpApprovalDispatch` cover the application boundaries and forged identity inputs.

Local browser testing exercised consent, code exchange, the eight-tool list, budget status, synthetic tool escalation, owner approval, single-use redemption, replay denial, excluded-tool denial, wrong-endpoint denial and disconnect. It used a seeded local Better Auth session.

The production Claude smoke used an existing signed-in session. The synthetic request appeared under the selected agent in Sanction, rejection reached Claude, and a subsequent budget call after disconnect required authentication. No purchase or external target action occurred. The run exposed text-only decisions appearing as failed tool calls; `tests/mcpDecisionContract.test.ts` covers the revised response contract through an MCP client. A post-deploy Claude check confirmed denial is a normal tool result, but Claude exposed only the readable text. The October 1 follow-up verified the JSON text fallback, explicit approval without a policy edit, exact-request redemption, and consumed-grant replay denial. Claude needed **Refresh tools list** on the existing connector to see the new request fields. Argument tampering, grant expiry, and a fresh recorded revocation sequence remain host-test follow-ups; automatic token refresh is not established by continued connection alone.
