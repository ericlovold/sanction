# Sanction for agent fleets

> Your platform runs a fleet of agents — paid media, content, outbound, ops —
> and some of them spend real money. Sanction is the governor underneath: every
> spending agent runs inside a budget envelope, over-cap actions stop and ask a
> human, one call pauses a seat, and every dollar lands in an audit trail your
> finance view can roll up by channel. This guide maps a fleet onto Sanction's
> primitives and wires it end to end — entirely through the API, so your
> platform can provision programmatically.

**Prerequisites:** a root wallet + management key (`sk_…`) — from
[getsanction.com/start](https://getsanction.com/start) or `POST /api/v1/wallets`.

---

## The mapping

| Fleet concept | Sanction primitive |
|---|---|
| The org / platform | Root wallet |
| A channel or spending fleet-agent (Paid Media, Content Studio…) | **Delegated pool** — child wallet with its own policy, budget owner, and management key |
| A seat (one agent instance, tool, or person) | **Agent key** (`pxy_…`), optionally with `holder` + `expires_at` |
| Spend envelope (monthly / daily / per-action caps) | Pool **policy**: `monthly_spend_budget_usd`, `daily_spend_budget_usd`, `per_transaction_max_usd` |
| Org-wide ceiling a channel can't break | `subtree_daily_cap_usd` — cascades: a seat's spend reserves against every ancestor atomically |
| Model/token budget | LLM **gateway** — hard 402 per seat at `daily_token_budget_usd` |
| "Notify at 80%" | `budget.threshold` / `budget.exhausted` events → email (default), Slack, webhooks — routable per channel |
| Over-cap request | **Escalation** → pending approval → single-use grant on retry |
| Kill-switch | `PATCH /agents { active: false }` per seat; loop a pool's seats to pause a channel |
| Contractor auto-shutoff | `expires_at` on the seat — the key fails closed past that instant |
| Chargeback / channel rollup | `GET /wallets/tree` (subtree rollup), `GET /wallets/stats`, audit export (CSV) |
| Cost-per-outcome ceiling (CAC-style) | The **learning-layer pattern** below — enforced through Sanction, computed by you |

## 1. Provision the fleet (scriptable, ~20 lines)

One pool per channel, one seat per agent instance. All management-plane calls
carry the relevant wallet's `x-mgmt-key`.

```bash
API=https://getsanction.com/api/v1

# A pool for the channel — child wallet under your root (returns its own sk_ once)
curl -s -X POST $API/wallets -H "x-mgmt-key: $ROOT_MGMT_KEY" -H "content-type: application/json" \
  -d '{"name":"paid-media","owner_email":"growth-lead@yourco.com","parent_id":"'$ROOT_WALLET_ID'"}'

# The channel's envelope — monthly + daily + per-action + escalation line
curl -s -X PATCH $API/wallets/policy -H "x-mgmt-key: $POOL_MGMT_KEY" -H "content-type: application/json" \
  -d '{"wallet_id":"'$POOL_ID'","monthly_spend_budget_usd":120000,"daily_spend_budget_usd":5000,
       "per_transaction_max_usd":500,"escalate_over_usd":250,"subtree_daily_cap_usd":6000}'

# A seat in the channel — returns its pxy_ key once
curl -s -X POST $API/agents -H "x-mgmt-key: $POOL_MGMT_KEY" -H "content-type: application/json" \
  -d '{"wallet_id":"'$POOL_ID'","name":"paid-media-search","holder":"search-campaign-agent"}'
```

The pool's `owner_email` is a real delegation: that budget owner signs in and
gets their own dashboard — envelopes, approvals queue, keys, audit — scoped to
their channel. Escalations from their seats land with *them*, not in a central
inbox.

## 2. Wire the two spend paths

**Model spend** — point each seat's SDK at the gateway; every token is metered
and the seat hard-stops (402) at its daily token budget. Two lines of config —
see [Vercel AI SDK](VERCEL-AI-SDK.md), [LangChain](LANGCHAIN.md),
[CrewAI](CREWAI.md), or the [runnable examples](../examples/README.md).

**Real-money spend** — before an agent buys, subscribes, or transfers, it calls
`POST /authorize` with its seat key and honors the decision:

```json
{ "action": "subscribe", "amount_usd": 480, "merchant": "Ad Platform",
  "category": "paid-media:d2c-search", "description": "budget bump — campaign 214" }
```

`approved` → act. `escalated` → a human sees it (email/Slack) with an approve
link; on approval the agent retries with the one-use `grant_id`.
`denied` (403) → a decision with a machine `code` and reason, not an error.
The decision resolves against the seat's limits, the pool's envelope, **and
every ancestor's subtree cap in one atomic evaluation** — a channel cannot
overspend even when every seat is individually under its own limit.

**Attribution convention:** make `category` carry your rollup key
(`channel:play` works well, as above). It's indexed through transactions,
audit events, and the CSV export — that's what lets finance tie every dollar
back to the play that spent it.

## 3. Route the budget signals

Budget meters emit at the 80% line and at exhaustion. Route them where the
right humans live (Dashboard → Approvals → Notification routes, or
`POST /webhooks`):

| Route | Subscribe to |
|---|---|
| `#growth-approvals` | `approval.created`, `approval.resolved` |
| `#finance-alerts` | `budget.threshold`, `budget.exhausted` |

Email to each pool's budget owner is on by default — zero config. Details in
[Notifications](NOTIFICATIONS.md).

## 4. The learning-layer pattern: cost-per-outcome ceilings

Sanction enforces dollars; *outcomes* (enrollments, bookings, conversions)
live in your platform. A CAC-style ceiling is a control loop between the two:

1. **Your learning layer computes the ratio** — channel spend (from
   `GET /wallets/stats` or your own attribution) ÷ outcomes (yours).
2. **When the ratio crosses the ceiling, throttle through the management API**
   — the fleet's aggression is a set of Sanction knobs:

```bash
# Soften: lower the seat's budgets and escalation line — spend keeps flowing,
# but bigger actions now stop and ask a human first
curl -s -X PATCH $API/agents -H "x-mgmt-key: $POOL_MGMT_KEY" -H "content-type: application/json" \
  -d '{"wallet_id":"'$POOL_ID'","agent_id":"'$SEAT_ID'","daily_spend_budget_usd":1500,"escalate_over_usd":50}'

# Hard stop: pause the seat (kill-switch); flip back with active: true
curl -s -X PATCH $API/agents -H "x-mgmt-key: $POOL_MGMT_KEY" -H "content-type: application/json" \
  -d '{"wallet_id":"'$POOL_ID'","agent_id":"'$SEAT_ID'","active":false}'
```

3. **To pause a whole channel**, list its seats (`GET /agents?wallet_id=…`)
   and flip each `active: false` — a three-line loop your kill-switch button
   calls.

Because throttling is policy mutation, not code deployment, your learning
layer can move money between channels in seconds — and every throttle action
is itself auditable. "Auto-throttled at the CAC ceiling" is this loop running
on a schedule.

## 5. What finance sees

- **Live envelopes** — per-pool used/cap/pressure on the Pools dashboard;
  the same numbers via `GET /wallets/stats` per node for your own UI.
- **Channel rollup** — `GET /wallets/tree` returns the wallet tree with spend
  and token cost rolled up per subtree: the chargeback table, one call.
- **Evidence** — every decision (including denials and throttles) carries its
  full context in the audit feed; CSV export for the close. See
  [Evidence & replay](CONCEPTS-EVIDENCE.md).

## Honest edges (today)

- **Token caps are per-seat and daily.** Monthly and pooled-per-channel token
  caps are on the roadmap; per-seat daily caps + threshold alerts cover the
  gap in practice. Money caps have all three horizons (per-action, daily,
  monthly) plus the subtree cascade.
- **Cost-per-outcome is a pattern, not a primitive.** Sanction doesn't ingest
  outcome events (yet) — the ratio lives in your learning layer, the
  enforcement in Sanction.
- **Channel pause is a loop over seats**, not a single pool-level flag.

## Reference

- [Quickstart](QUICKSTART.md) · [Gateway](GATEWAY.md) ·
  [Multi-tenant runbook](INTEGRATION.md) (per-customer fleets — same tree,
  different tenancy)
- [Authorization concepts](CONCEPTS-AUTHORIZATION.md) ·
  [Domain glossary](DOMAIN.md) ·
  [OpenAPI spec](https://getsanction.com/api/openapi.json)
