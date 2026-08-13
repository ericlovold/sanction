# Approvals that find you — email, Slack, webhooks

An escalated request is only useful if a human sees it fast. Sanction delivers
every escalation and budget alert three ways; pick any or all.

## Email (on by default)

The wallet owner's email receives every escalation with an approve link, and a
heads-up when any budget crosses its 80% line. Nothing to configure.

## Slack

Two setups. Incoming webhooks stay a deep-link. In-Slack Approve/Deny needs a
Slack app — incoming webhooks cannot receive button clicks.

### Incoming webhook (Review link)

1. In Slack: create an **incoming webhook** for the channel (Slack admin → Apps
   → Incoming Webhooks → Add to channel). You get a `https://hooks.slack.com/...`
   URL.
2. In Sanction: **Dashboard → Approvals → Notification routes** → paste the URL.
   Sanction detects Slack automatically and sends a connect ping.

Escalations arrive as readable Block Kit with a **Review in Sanction** button.
No Slack app. The webhook URL is the secret.

### Interactive Approve/Deny (Slack app)

1. Create a Slack app. Enable **Interactivity** with Request URL
   `https://getsanction.com/api/slack/interactive`. Bot scope: `chat:write`.
   Invite the bot to the channel.
2. Set `SANCTION_SLACK_SIGNING_SECRET` and `SANCTION_SLACK_BOT_TOKEN` on the
   Sanction deployment. The interactive endpoint **fails closed** (503) if the
   signing secret is unset.
3. Paste the channel archive URL (`https://slack.com/archives/C…`) as the
   notification route.

Escalations then carry **Approve** / **Deny** plus the Review link. The click
runs the same `resolveApproval` path as the dashboard (grant, audit, resolved
events). The actor is recorded as `slack:<username>`. Anyone in that channel
can decide — the channel is the ACL.

Signature: Slack's `v0` HMAC over the raw body. Stale timestamps (>5 minutes)
and bad signatures are 401. Rate-limited per IP.

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
