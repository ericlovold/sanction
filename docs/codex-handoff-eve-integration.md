# Codex handoff: sanction + eve integration

## Objective

Wire eve as the conversational onboarding layer for Sanction, the authorization plane for AI agents. Sanction approves, escalates, or denies spend, MCP tool calls, credential use, provisioning, and x402 payment challenges before they become irreversible. It is not sanctions screening or compliance matching.

The intended first-run conversation, from `agent/instructions.md`:

1. Call `sanction_wallet_status` to confirm the wallet connection and budget headroom.
2. Explain that Sanction is ask-first, and honor `next_action` on every decision (`proceed` / `wait` / `retry_with_grant` / `stop`).
3. Use only the shipped MCP tools listed below. Roster scan and seat-plan preview/apply are **not available** — future work, not tools to call.

Hosted MCP lives at `https://getsanction.com/mcp` (override with `SANCTION_MCP_URL`). Authenticate with `SANCTION_API_KEY` (`pxy_...`) as `x-api-key`. Unset or non-`pxy_` keys fail closed when the agent connects; never hardcode or log a key.

Shipped wallet tools: `sanction_authorize`, `sanction_authorize_provision`, `sanction_authorize_tool`, `sanction_authorize_capability`, `sanction_log_tokens`, `sanction_log_outcome`, `sanction_request_execution`, `sanction_inject_credential`, `sanction_wallet_status`, `sanction_check_authorization`. Roster submission and seat-plan tools are not on that surface yet.

## Current implementation (main)

- `/dashboard/eve` is a preview mockup. Example teams and spend are hardcoded. The page is labeled preview and is off the default sidebar until it runs on real connector state. The route stays reachable by URL.
- `agent/` holds sanction-specific instructions and an MCP client pointed at `https://getsanction.com/mcp`. The connection reads `SANCTION_API_KEY` at request time and sends it as `x-api-key`.
- `next.config.ts` mounts eve routes through `withEve`. Off Vercel, `npm run build` runs `eve build` so `npm start` has a compiled agent; on Vercel that step is skipped because `VERCEL=1` would make a bare `eve build` write `.vercel/output` and collide with Next.js.
- The eve runtime dependency is installed (`engines.node >= 24`, matching eve 1.0.0-rc.8). Connector status is not persisted. Do not claim a connector is connected until status confirms it.

## Important constraints

1. Use eve for durable agent behavior; do not replace it with ad hoc route handlers or client-only state.
2. Use Vercel Connect for third-party credentials and channels. Never add Slack, directory, or model secrets to source files or `.env` examples.
3. Use the existing database for user/org data. Do not add localStorage, hardcoded production data, or a second persistence layer. Preview example data on `/dashboard/eve` is temporary and must be replaced by confirmed connector state.
4. Preserve the existing dashboard shell, responsive behavior, and access-control conventions.
5. Keep all user-facing copy lowercase for `eve`.
6. Never claim a connector is connected until status confirms it.

## Recommended next slice

### 1. Validate the eve runtime

- Run the repository checks and `eve build`.
- Confirm the Next.js eve route mounting works in development.
- Fix any type/config mismatch around the `withEve` wrapper without weakening the runtime configuration.
- Add a focused health/status check for the agent route.

### 2. Persist connector onboarding

Add a database-backed connector model scoped to the authenticated organization/user. It should track:

- provider and connection type
- display name
- requested scopes/capabilities
- status: `draft`, `pending`, `connected`, `error`, `revoked`
- created/updated timestamps
- last error code/message safe for display

Do not store provider access tokens. Store only the Vercel Connect connector identifier and non-secret metadata.

### 3. Wire the onboarding page

Replace the preview mockup with real server actions or route handlers:

- create a connector request
- open/resume Vercel Connect setup
- refresh status after setup
- disconnect/revoke a connector
- show actionable error states

The page should remain usable on mobile, use accessible buttons and labels, and never claim a connector is connected until status confirms it. Remove the example teams and spend once a confirmed snapshot exists.

### 4. Add an eve web channel

Keep the public surface restricted by default. Add a dashboard chat/status surface only for authenticated sanction users, then expose eve's web channel through the existing app shell. The agent should be able to:

- explain a roster snapshot and its provenance
- preview a seat plan (pools, seats, budgets, policy packs)
- identify missing review information
- request authorization through Sanction MCP; draft, but not autonomously apply, a seat plan

Sensitive actions require explicit owner approval and an auditable event. Applying a plan uses `sanction_authorize_provision` and the existing grant redeem loop.

### 5. Add auditability

Create an append-only audit record for connector changes, agent runs, approvals, and authorization decisions. Capture actor, organization, action, target, timestamp, result, and a redacted metadata payload. Add a small activity panel to the dashboard before enabling destructive workflows.

## Acceptance criteria

- `npm run check` passes.
- `eve build` passes.
- A user can connect and disconnect a configured provider without tokens appearing in the browser, logs, or database records.
- Connector state survives reloads and is scoped to the current organization/user.
- An authenticated user can reach the eve status/chat surface; unauthenticated users cannot.
- Every approval and connector state change produces an audit event.
- The UI has loading, empty, error, and revoked states and works at mobile width.
- No production action is executed without explicit approval.
- The UI never claims a connector is connected until status confirms it.

## Suggested implementation order

1. Inspect existing auth, organization, and database patterns.
2. Verify the current eve build and route mount.
3. Add the connector/audit schema and migration through the project's established database workflow.
4. Implement server-side connector actions and status mapping.
5. Replace onboarding placeholders with confirmed connector state.
6. Add the restricted eve web channel and approval boundary.
7. Add tests for authorization, connector state transitions, and audit records.
8. Run checks, browser verification, and update this handoff with any deviations.

## Open product decision

Restricted web access for authenticated sanction users, with Slack or other external channels added only after the connector ownership and audit model are proven. If a public intake channel is required, define tenant-routing and abuse controls before enabling it.

eve is in provider scope as a preview integration alongside ChatGPT (2026-11-10). The preview page stays off the default sidebar until it runs on real connector state.
