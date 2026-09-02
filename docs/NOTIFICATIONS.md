# Approvals that find you — email, Slack, webhooks

An escalated request is only useful if a human sees it fast. Sanction delivers
every escalation and budget alert three ways; pick any or all.

## Email (on by default)

The wallet owner's email receives every escalation with an approve link, and a
heads-up when any budget crosses its 80% line. Nothing to configure.

## Slack

One path: **Add to Slack**. Escalations arrive as a card with **Approve**,
**Deny**, and **Review in Sanction**; a click resolves the approval through the
same path as the dashboard and mints the same one-use grant.

1. Have a wallet and an admin session ([create one](/start) if you don't).
2. Dashboard → Approvals → **Add to Slack**. Pick the channel at install.
   Sanction stores the workspace bot token under the wallet's encrypted vault.
3. Press **Send a test escalation**. A real $30 escalation is raised on one of
   your agents, labeled as a test, and the card lands in the channel within
   seconds. Approve it there; the grant shows on the Approvals page.

**Who can decide:** anyone in that channel. The channel is the approver group,
so connect a private channel for approvals. The actor is recorded as
`slack:<username>` on the decision.

Security: Slack's `v0` HMAC over the raw body; timestamps older than five
minutes and bad signatures are 401; each button carries a two-hour token bound
to the wallet, approval, workspace, and channel; the endpoint fails closed (503)
if the signing secret is unset. Disconnect on the same page revokes the install.

<details>
<summary>Self-hosting: the Slack app you need</summary>

Create a Slack app with scopes `chat:write` and `incoming-webhook`. Enable
**Interactivity** with Request URL `https://<your-host>/api/slack/interactive`
and set the OAuth Redirect URL to `https://<your-host>/api/slack/oauth/callback`.
Set `SANCTION_SLACK_SIGNING_SECRET`, `SANCTION_SLACK_CLIENT_ID`, and
`SANCTION_SLACK_CLIENT_SECRET` on the deployment. OAuth start returns 503 until
the client id is set.
</details>

<details>
<summary>Notification-only routes (no buttons)</summary>

An **incoming webhook** URL (`https://hooks.slack.com/...`) pasted into
Notification routes gets readable Block Kit messages with a **Review in
Sanction** link — no app, the URL is the secret, but Slack cannot send button
clicks back. The env `SANCTION_SLACK_BOT_TOKEN` plus a pasted channel archive
URL (`https://slack.com/archives/C…`) is the older platform-token fallback and
also posts the link only. Interactive decisions require Add to Slack.
</details>

## Route different events to different channels

Each notification route subscribes to its own event list, so channel routing is
just multiple routes:

| Channel | Subscribe to |
|---|---|
| `#approvals` | `approval.created`, `approval.resolved` |
| `#finance-alerts` | `budget.threshold`, `budget.exhausted` |
| `#leadership` | `report.weekly_digest` (Monday rollup, nothing else) |
| `#agent-ops` | `*` (everything) |

Add each Slack URL as its own route with the matching events via
`POST /v1/webhooks` (`events` array), or the dashboard form for the default set.

## The weekly digest (opt-in)

Routes subscribed to `report.weekly_digest` get last week in one message every
Monday: spend and token cost with week-over-week deltas, approved / denied /
escalated counts, secret accesses, and the busiest agent. It is never in the
default event set — subscribe the routes that want it (or a `*` route hears it
like everything else). A quiet week still reports; all zeros is information.

## Machine consumers (your own systems)

Any non-Slack `https` endpoint receives the raw event JSON, signed:

```
POST <your-url>
x-sanction-event: approval.created
x-sanction-signature: sha256=<HMAC-SHA256 of the exact body, keyed by your route's whsec_ secret>
```

Verify the signature before trusting the event. The signing secret is shown
once when the route is created. Endpoints must be public `https` — loopback,
private ranges, and cloud-metadata hosts are rejected at registration.

## The loop, end to end

1. Agent calls `/v1/authorize` → policy says **escalate**.
2. You get the Slack ping → tap **Approve** or **Deny** (interactive app) or
   **Review in Sanction** (incoming webhook).
3. Approval mints a one-use grant; the agent redeems it with `grant_id` and
   proceeds. Every step is in the audit feed (`GET /v1/audit-events`).
