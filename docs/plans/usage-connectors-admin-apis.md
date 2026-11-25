# Usage connectors: admin and analytics APIs

Status: proposal plus one working prototype (GitHub Copilot) on branch `claude/usage-admin-connectors`. Research read from official docs on 2026-11-25. Each claim below is marked **verified** (read on the provider's own docs), **inferred**, or **unknown**.

Goal: a customer picks the tools their team uses, connects each in as few clicks as the provider allows, and the first dashboard shows only those tools. Every connector maps into one usage model by org, team, person and tool. That model feeds approvals, budgets and observability.

## Verdict

**Only GitHub and Google offer one-click connect.** For Anthropic, OpenAI, Cursor and xAI, the best possible flow is "pick the tool, paste one admin key". No third-party OAuth exists for their usage data, so Sanction cannot remove that one paste.

| Tool and plan | How it connects | What it gives | In Sanction |
| --- | --- | --- | --- |
| GitHub Copilot (org on Business or Enterprise) | **One click** once Sanction has a GitHub App: an org owner installs it. Today: a fine-grained token plus the org name. | Billed cost per day and model; per-person usage report | **Built on this branch** (token route) |
| Google Gemini in Workspace, Code Assist, Vertex | **One click** with Google OAuth | Workspace: activity per person, no cost. Code Assist: per-project metrics. Cost only through a BigQuery billing export the customer already runs | Not built |
| Google Gemini API (AI Studio) | **Nothing.** No usage or cost API is documented | Billing reports in the console only | Not possible |
| Claude API (Console org) | Admin key | Cost and tokens per person, model, product, hour | Built |
| Claude Enterprise | Analytics key, created by the Primary Owner | Same cost endpoint, plus per-person engagement (chat, Claude Code, Cowork) | Not built |
| Claude Code on a Console org | Admin key (same as above) | Sessions, lines, commits, PRs, estimated cost per person per day | Not built |
| Claude Team | **Nothing.** CSV export only | | Not possible (CSV upload later) |
| Claude Pro or Max | **Nothing** via admin APIs | | Local collector (bucket 3) |
| OpenAI API | Admin key | Tokens per hour, cost per day | Built (completions only) |
| ChatGPT Enterprise, Edu, Codex sign-in | Workspace admin key with an analytics scope | Daily usage feed; routes and fields **unknown** (page would not load) | Not built |
| Cursor Teams or Enterprise | Admin key | Spend per person, model, hour | Built |
| Cursor individual | **Nothing** | | Local collector (bucket 3) |
| xAI API | Management key | Spend by key, user, model, product | Not built |
| Grok Business seats | **Nothing** documented | | Not possible |

What "one paste" can still feel like: the tool card deep-links to the exact page where the key is created, lists the permissions to tick, says who in the org can create it, and checks the key before saving. That flow exists today for Cursor, Claude and OpenAI.

## What Sanction already syncs

`lib/connectors/` has three admin-key connectors. All of them map into `UsageFact` (`prisma/schema.prisma`):

| Connector | Endpoint | Grain |
| --- | --- | --- |
| Cursor (`cursor.ts`) | `POST /teams/filtered-usage-events` | event, rolled to the hour |
| Claude (`anthropic.ts`) | `/v1/organizations/analytics/usage` and `/cost` | hour |
| OpenAI (`openai.ts`) | `/v1/organization/usage/completions` and `/v1/organization/costs` | hour for tokens, day for money |

One hourly cron (`app/api/cron/usage-sync/route.ts`) pulls each due connection in turn. Keys are envelope-encrypted in `CredentialVault` under the reserved label `usage:<provider>:<connectionId>`, which `/exec` and the vault API refuse to inject.

Two pages render every provider, connected or not. That is where the "empty Google key" and "empty Perplexity key" come from:

- `app/dashboard/ai-spend/page.tsx` maps all of `USAGE_PROVIDERS`.
- `/dashboard/providers` maps all four gateway `PROVIDERS` in `lib/providers.ts`.

## Provider research

### Anthropic (verified)

- **Usage and Cost Analytics API** (beta), at `/v1/organizations/analytics/usage` and `/cost`.
  - Available to Console orgs and Claude Enterprise. Not to Team, not to individual accounts.
  - Buckets of 1 minute, 1 hour or 1 day. Group by actor, model, product or workspace.
  - Data lands in 4 to 24 hours and can change until about 7 days after the month ends.
  - At most 31 days per request, with a 365-day lookback.
  - On seat-based Enterprise plans, cost reflects usage credits only.
- **Auth**:
  - Console: an Admin key (`sk-ant-admin01-`).
  - Enterprise: a `read:analytics` key created by the Primary Owner in claude.ai.
  - The only OAuth for org admin is issued through Anthropic's own CLI. The public Claude Platform OAuth scope is `billing:attribution`, which works on inference endpoints only.
- **Claude Code Analytics API**, at `/v1/organizations/usage_report/claude_code`.
  - Console orgs, Admin key.
  - Daily per person: sessions, lines added and removed, commits, PRs, tool accept and reject, tokens and estimated cost per model. About 1 hour behind.
- **Enterprise Analytics**, at `GET /v1/organizations/analytics/users`.
  - Per person per day: chat, Claude Code (commits, sessions, lines, PRs), Cowork and others.
  - 60 requests a minute. Ready about 13:00 UTC the next day. Admin keys are rejected.
- **Team plan**: CSV only. **Compliance API**: audit only, no usage.

### OpenAI

- **API platform** (verified):
  - Usage endpoints for completions, embeddings, images, audio, vector stores and tools, in 1-minute, 1-hour or 1-day buckets.
  - Costs come in 1-day buckets only. Some `user_id` groupings return HTTP 400.
  - Admin key only. No OAuth for usage. "Sign in with ChatGPT" scopes read no usage.
- **ChatGPT Business, Enterprise and Edu, and Codex**:
  - Verified: a daily usage analytics feed covering ChatGPT, Codex and Work, behind a workspace admin key with `enterprise.analytics.usage.read`.
  - Verified: a separate Codex analytics scope.
  - Unknown: routes, fields, per-person detail and freshness. The reference page renders with JavaScript and could not be read.
  - Verified: since June 2026, Enterprise credit use by person, product and model is in the admin console. The announcement says it is also in "the unified Cost API". Unknown whether that means `/v1/organization/costs`.
- **Where a Codex user shows up depends on how they signed in** (inferred from the two sources being separate). A Codex user signed in with an API key shows in the platform usage; one signed in with ChatGPT shows only in the workspace feed. The Codex CLI can also emit OpenTelemetry, which the bucket-3 collector already accepts.

### Cursor (verified)

- **Admin API**, with Basic auth (the key is the username).
  - Endpoints: members, daily usage (20 a minute, 30 days a call), filtered usage events (60 a minute), spend, billing items, groups.
  - Cursor asks for at most one poll an hour.
  - Plan coverage conflicts in Cursor's docs for Teams versus Enterprise.
- **Analytics** and **AI Code Tracking** APIs are Enterprise only. No OAuth.

### xAI (verified)

- Endpoint: `POST https://management-api.x.ai/v1/billing/teams/{team_id}/usage`, with a management key a team admin enables.
- Time units from month down to second. Group by key, user, model and product. No OAuth.
- Freshness and rate limits are not documented.
- No Grok Business seat analytics API.

### Google

- **Gemini API (AI Studio)** (verified): no usage or cost API. Keys have no billing of their own.
- **Cloud Billing**:
  - Cost comes only through a BigQuery export, usually within a day (verified).
  - The Billing REST API returns accounts and SKUs, not spend (verified).
  - The Budget API pushes estimated spend several times a day (verified).
- **Cloud Monitoring** (verified): request counts per API key, no tokens or cost.
- **Gemini for Workspace** (verified):
  - Admin SDK Reports API, `applicationName=gemini_in_workspace_apps`.
  - Per-person activity with no token or credit data, 2 to 3 days behind.
- **Gemini Code Assist** (verified): per-project metrics. Per-person detail needs Cloud Logging turned on.
- **OAuth** (verified): standard Google OAuth with the monitoring, billing, BigQuery and reports scopes. The sensitive scopes need Google's app verification, which can take up to 10 days. An app used only inside its own org is exempt.

### GitHub Copilot (verified unless marked)

- **Usage metrics** (API version `2026-03-10`):
  - Call `GET /orgs/{org}/copilot/metrics/reports/users-1-day?day=` for signed download links to an NDJSON file with one record per person.
  - Each record holds `user_login`, `ai_credits_used`, activity counts, lines of code, and per-IDE, feature, language and model breakdowns.
  - GitHub calls `ai_credits_used` "a metrics signal ... not a billed total".
  - Needs "Organization Copilot metrics" (read), and the org's usage metrics policy turned on.
- **Billing**:
  - Call `GET /organizations/{org}/settings/billing/ai_credit/usage` (and `premium_request/usage` for legacy plans) with `year`, `month`, `day`, and optionally `user`, `model`, `product`.
  - Each item carries gross, discount and net amounts in USD.
  - Needs "Administration" (read). History goes back 24 months.
- **One click**: a GitHub App that an org owner installs. Install and user sign-in are separate steps.
- **Unknown**: how many days the report lags (a summary said about two; not read verbatim). It also says breakdowns depend on IDE telemetry.

## Connector interface

The adapter shape in `lib/connectors/adapters.ts` stays as it is. One change on this branch: the adapter now receives a credential object instead of a bare key.

```ts
type ConnectorCredential = { secret: string; accountRef: string | null }
type ConnectorAdapter = {
  endpoint: string
  pull(credential, window: { startMs; endMs }, deps?): Promise<{ facts; fromMs; httpCalls; refreshedAt }>
  probe(credential, now, deps?): Promise<void>
}
```

`accountRef` is the provider-side account a pull reads when the key alone does not name one: the GitHub org, the xAI team id, the Google project or BigQuery table. It is not secret, so it lives on `UsageConnection` and never in the vault.

For OAuth and App installs, propose that `secret` stays what the adapter is handed: a short-lived access token that the sync mints just before the pull. The adapter never sees the refresh token or the App private key. That keeps every adapter testable with a plain string.

`ConnectorError` kinds already cover every case found: bad key, plan unsupported, rate limited, provider unavailable, unexpected response, missing credential.

## Normalized usage schema

`UsageFact` stays the money grain: provider, surface, person, model, bucket, tokens, requests, nano-dollar cost and a cost basis (billed, allocated, included, estimated). Proposed additions, to agree with the bucket-2 and bucket-3 tracks before anyone builds them.

The local-collector track's proposal (`docs/plans/local-usage-collector.md` on branch `claude/local-usage-collector`) agrees on the core and names it more precisely:
- a `tool` column on `UsageFact`, which is what the picker selects, separate from the billing provider;
- a `source` column, where admin_api wins for money;
- `UsageConnection.kind`, with the unique key widened to wallet, provider and kind.

Adopt their names. The `kind` change matters here too: today one wallet cannot hold both a Claude Console and a Claude Enterprise connection, or a Copilot org and a personal Copilot account. The items below are the parts that proposal does not cover, or covers differently.

1. **`UsageConnection.accountRef`**: done on this branch, with an additive nullable migration.
2. **`UsageToolSelection`** (walletId, tool, route, selectedAt, selectedBy): "the tools you use", stored before anything is connected. The dashboard reads it to decide which cards exist. A selected but unconnected tool shows one "Connect" card. An unselected tool shows nothing.
3. **A `source` on every usage row** (the collector track's `source`: admin_api, billing_api, otlp, collector, upload).
   - Admin-API billed rows win for the same person, tool and day.
   - Collector rows fill in only where no admin connection exists for that tool.
   - This prevents counting one Claude Code session twice. Bucket 3 owns the collector side.
4. **`UsageActivity`** (walletId, connectionId, provider, rawIdentity, day, metrics as JSON or typed columns): engagement with no money attached. It holds the Copilot per-person report, the Claude Enterprise users endpoint, Claude Code analytics and Cursor daily usage. Kept apart from `UsageFact` so activity never sums into spend.
5. **Identity links** (walletId, provider, rawIdentity, memberEmail): people appear as an email (Claude), `github:<login>` (Copilot) or an OpenAI user id. Budgets per person need one join table. Until it exists, each tool's people are listed separately.

## Sync schedule

The cron is hourly for everyone today. Propose a `pullEveryMs` per provider in `lib/connectors/registry.ts`, so a provider whose data changes daily is not asked 24 times a day:

| Provider | Data updates | Pull |
| --- | --- | --- |
| Cursor | hourly | hourly (Cursor's own limit) |
| Claude API | 4 to 24 hours | hourly, re-reading 8 days |
| OpenAI | hourly tokens, daily cost | hourly, re-reading 3 days |
| Copilot | daily bill, daily report | every 6 hours, re-reading 4 days |
| Claude Enterprise analytics | daily, about 13:00 UTC | daily at 14:00 UTC |
| xAI | unknown | hourly until measured |
| Google billing export, Workspace reports | daily, 1 to 3 days late | daily |

## Credential storage

- **Admin keys and tokens**: unchanged. Stored through the envelope encryption in `lib/credentialCrypto.ts` (per-wallet data key, KMS in production). The reserved `usage:` label is never injectable. Disconnect hard-deletes the key, and a key older than 90 days shows a warning.
- **GitHub App**:
  - One App per Sanction deployment. Its private key lives in the deployment's secret store, never in the database.
  - Each install stores only its installation id and org login on `UsageConnection`.
  - The sync mints a one-hour installation token per pull and never stores it.
  - Uninstalling on GitHub revokes access with no action from Sanction.
- **Google OAuth**:
  - The refresh token goes in the vault under the same reserved label. Access tokens live in memory for one pull.
  - Ask for the narrowest scopes per route, never `cloud-platform` unless the Budget API is chosen.
- **Every connector**:
  - Read-only permissions.
  - Errors list field paths only, never values, because values include other people's emails and logins.
  - Nothing reads prompts, code or completions.

## Connect UX

1. **Pick tools.** "Which AI tools does your team use?" as chips: Claude, ChatGPT and Codex, Cursor, GitHub Copilot, Gemini, Grok, Other. Saved to `UsageToolSelection`.
2. **Pick the route, only when it matters.** "How does your team pay for Claude?" API, Enterprise, Team, or Pro and Max. The route decides the method. Claude's card already lists routes in `registry.ts`.
3. **Connect.** One of three shapes:
   - **Button**: GitHub ("Install on your organization"), Google ("Sign in with Google").
   - **One paste**: Claude, OpenAI, Cursor, xAI. A deep link to the key page, the exact permissions, and who can create it.
   - **No API**: Claude Team, Pro and Max, Cursor individual, Grok seats. Offer the local collector (bucket 3) or a CSV upload, and say plainly that the provider offers no API.
4. **First dashboard.** Shows only connected tools, with a "waiting for first data" state that says how late that provider runs. An unselected tool never appears.

The same rule applies to `/dashboard/providers`: show configured gateway keys, plus one "Add a provider" action, instead of four empty cards.

## Prototype: GitHub Copilot

Built on `claude/usage-admin-connectors`, not merged, not deployed.

- `lib/connectors/copilot.ts`:
  - For each UTC day, reads AI credit and legacy premium request billing, then the per-person report.
  - Splits each model's billed (net) amount across people by their `ai_credits_used` share. Plan-included (discount) amounts are split the same way and kept apart. Uses `allocate` from `money.ts`, so every split sums exactly to GitHub's number.
  - A day with no report yet stays whole as one unattributed row. The 4-day re-read replaces it once the report lands.
  - A refund is never split.
- **Safety**:
  - The GitHub token is never sent to the signed report links.
  - Only https links are fetched, and a report is capped at 50 MB.
  - The org name is checked against GitHub's login rules before it goes into any URL.
- `UsageConnection.accountRef`, with migration `20261125150000_usage_connection_account_ref` (additive, nullable).
- The connect card asks for the organization and says "token" instead of "API key".
- **Tests**:
  - `tests/connectors-copilot.test.ts`: contract, split, HTTP, rate limits, adapter.
  - New cases in `tests/ai-spend-actions.test.ts` and `tests/usage-connectors.db.test.ts`. The DB case: the first pull splits a reported day and keeps the next day unattributed; the second pull re-splits it; the month total stays equal to the bill.

**Not verified until a real org is connected:**

- The fixtures are built from GitHub's field lists, not recorded responses.
- Whether `netAmount` comes as a number or a string. Both are accepted.
- Whether an org on AI credits gets an empty list or a 404 from the legacy endpoint. A 404 is read as "no legacy billing".
- How many days the report lags.
- Whether `ai_credits_used` tracks billing closely enough for a fair split. Per-person billing is exact if needed, using the `user` filter, at one call per person per day.

The first live check: one org, one closed day. Compare GitHub's billing page to Sanction's day total, then each person's share to what they expect.

## Decisions for Eric

1. **Register a Sanction GitHub App** with Administration (read) and Organization Copilot metrics (read), and no webhooks. This turns Copilot into a true one-click install.
   - It creates an App on a GitHub account and adds a private key to the deployment secrets. That needs your yes.
   - "Administration (read)" is broad; some org owners will hesitate. The token route stays as the fallback.
2. **Google**: Workspace activity and BigQuery cost are both possible through one OAuth consent. Sensitive scopes need Google verification unless the app is internal. Worth it only if customers use Gemini enough. The Gemini API alone gives nothing.
3. **Schema items 2 to 5 above** touch the other two tracks. Agree on them before either builds its own version.
