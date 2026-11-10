# Codex handoff: sanction + eve integration

## Objective

Turn sanction into a production-ready control plane for an eve-powered sanctions/compliance agent. The first increment should connect the existing dashboard onboarding experience to a real eve agent lifecycle without introducing mock persistence or exposing provider credentials.

## Current branch and implementation

- Branch: `v0/eve-integration`
- Existing PR commit: `f23a7db Add eve integration onboarding`
- Added `/dashboard/eve` onboarding UI.
- Added an `agent/` directory with sanction-specific instructions and a connection definition.
- Updated `next.config.ts` to mount eve routes through `withEve`.
- Added the eve runtime dependency.

## Important constraints

1. Use eve for durable agent behavior; do not replace it with ad hoc route handlers or client-only state.
2. Use Vercel Connect for third-party credentials and channels. Never add Slack, sanctions-data, or model secrets to source files or `.env` examples.
3. Use the existing database integration for user/org data. Do not add localStorage, hardcoded production data, or a second persistence layer.
4. Preserve the existing dashboard shell, responsive behavior, and access-control conventions.
5. Keep all user-facing copy lowercase for `eve`.

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

Replace the current presentation-only actions with real server actions or route handlers:

- create a connector request
- open/resume Vercel Connect setup
- refresh status after setup
- disconnect/revoke a connector
- show actionable error states

The page should remain usable on mobile, use accessible buttons and labels, and never claim a connector is connected until status confirms it.

### 4. Add an eve web channel

Keep the public surface restricted by default. Add a dashboard chat/status surface only for authenticated sanction users, then expose eve's web channel through the existing app shell. The agent should be able to:

- explain a sanction match and its evidence
- summarize a case
- identify missing review information
- draft, but not autonomously execute, high-impact enforcement actions

Sensitive actions require explicit approval and an auditable event.

### 5. Add auditability

Create an append-only audit record for connector changes, agent runs, approvals, and enforcement decisions. Capture actor, organization, action, target, timestamp, result, and a redacted metadata payload. Add a small activity panel to the dashboard before enabling destructive workflows.

## Acceptance criteria

- `npm run check` passes.
- `eve build` passes.
- A user can connect and disconnect a configured provider without tokens appearing in the browser, logs, or database records.
- Connector state survives reloads and is scoped to the current organization/user.
- An authenticated user can reach the eve status/chat surface; unauthenticated users cannot.
- Every approval and connector state change produces an audit event.
- The UI has loading, empty, error, and revoked states and works at mobile width.
- No production action is executed without explicit approval.

## Suggested implementation order

1. Inspect existing auth, organization, and database patterns.
2. Verify the current eve build and route mount.
3. Add the connector/audit schema and migration through the project’s established database workflow.
4. Implement server-side connector actions and status mapping.
5. Replace onboarding placeholders with real state.
6. Add the restricted eve web channel and approval boundary.
7. Add tests for authorization, connector state transitions, and audit records.
8. Run checks, browser verification, and update this handoff with any deviations.

## Open product decision

The default recommendation is **restricted web access for authenticated sanction users**, with Slack or other external channels added only after the connector ownership and audit model are proven. If sanction must support a public intake channel, define the tenant-routing and abuse controls before enabling it.
