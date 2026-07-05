# Approvals that find you — email, Slack, webhooks

An escalated request is only useful if a human sees it fast. Sanction delivers
every escalation and budget alert three ways; pick any or all.

## Email (on by default)

The wallet owner's email receives every escalation with an approve link, and a
heads-up when any budget crosses its 80% line. Nothing to configure.

## Slack (one paste)

1. In Slack: create an **incoming webhook** for the channel that should get
   approvals (Slack admin → Apps → Incoming Webhooks → Add to channel). You get
   a `https://hooks.slack.com/...` URL.
2. In Sanction: **Dashboard → Approvals → Notification routes** → paste the URL.
   Sanction detects Slack automatically and sends a connect ping.

From then on:

- Escalations arrive as *"⏳ **nightly-coder** needs approval for **$60.00** —
  Vendor"* with a **Review in Sanction** button.
- Budget warnings arrive at the same 80% line the dashboard meters show:
  *"⚠️ **nightly-coder** has used **84%** of its daily spend."*
- Denied-wall and resolution events post too.

No Slack app to install, no OAuth. The webhook URL is the whole setup — treat
it like a secret, because Slack does.

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
2. You get the Slack ping → tap **Review in Sanction** → confirm-to-approve.
3. Approval mints a one-use grant; the agent redeems it with `grant_id` and
   proceeds. Every step is in the audit feed (`GET /v1/audit-events`).
