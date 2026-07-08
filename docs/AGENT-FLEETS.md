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
| Model/token budget | LLM **gateway** — hard 402 at the seat's daily or monthly token budget, or the pool's `subtree_daily_token_cap_usd` (the whole channel stops even when every seat is individually under) |
| "Notify at 80%" | `budget.threshold` / `budget.exhausted` events → email (default), Slack, webhooks — routable per channel |
| Over-cap request | **Escalation** → pending approval → single-use grant on retry |
| Kill-switch | `POST /wallets/freeze` — one control stops a wallet **and its whole subtree** on every data plane (`WALLET_FROZEN`); unfreeze resumes exactly where the fleet stopped. Per-seat: `PATCH /agents { active: false }` |
| Contractor auto-shutoff | `expires_at` on the seat — the key fails closed past that instant |
| Chargeback / channel rollup | `GET /wallets/tree` (subtree rollup), `GET /wallets/stats`, audit export (CSV) |
| Cost-per-outcome ceiling (CAC-style) | **Native (CPO-1):** report outcomes to `POST /outcomes`, set the ceiling on the pool's policy — when marginal cost-per-outcome would cross it, further spend escalates |

## 1. Provision the fleet (scriptable, ~20 lines)

One pool per channel, one seat per agent instance. All management-plane calls
carry the relevant wallet's `x-mgmt-key`.

```bash
API=https://getsanction.com/api/v1

# A pool for the channel — child wallet under your root (returns its own sk_ once)
curl -s -X POST $API/wallets -H "x-mgmt-key: $ROOT_MGMT_KEY" -H "content-type: application/json" \
  -d '{"name":"paid-media","owner_email":"growth-lead@yourco.com","parent_id":"'$ROOT_WALLET_ID'"}'

# The channel's envelope — monthly + daily + per-action + escalation line,
# plus the pooled token cap (whole-channel daily token hard stop)
curl -s -X PATCH $API/wallets/policy -H "x-mgmt-key: $POOL_MGMT_KEY" -H "content-type: application/json" \
  -d '{"wallet_id":"'$POOL_ID'","monthly_spend_budget_usd":120000,"daily_spend_budget_usd":5000,
       "per_transaction_max_usd":500,"escalate_over_usd":250,"subtree_daily_cap_usd":6000,
       "subtree_daily_token_cap_usd":500,"monthly_token_budget_usd":500}'

# A seat in the channel — returns its pxy_ key once
curl -s -X POST $API/agents -H "x-mgmt-key: $POOL_MGMT_KEY" -H "content-type: application/json" \
  -d '{"wallet_id":"'$POOL_ID'","name":"paid-media-search","holder":"search-campaign-agent"}'
```

Or install the whole envelope in one call: the **fleet-channel-envelope**
policy pack (`POST /policy/packs/fleet-channel-envelope/apply`) ships this
shape with the outcome-ceiling knobs pre-wired — preview it against your last
30 days first (`…/preview`).

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

**Attribution:** pass `tags` on the authorize call —
`"tags": {"channel": "paid-media", "play": "d2c-search"}` (≤8, never read by
policy rules). They persist on the decision and come back on audit-feed events
and as a CSV column, so finance ties every dollar to the play that spent it.
`category` stays the policy-relevant field (allow/block lists key on it).

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

## 4. Cost-per-outcome ceilings — native (CPO-1)

Sanction enforces dollars *accountable to results*. Your platform reports the
outcomes — an enrollment, a booked visit, a signed engagement — and Sanction
governs the ratio; it never invents outcomes.

**Report outcomes** as they happen (seat key; also available as the
`sanction_log_outcome` tool from any MCP host):

```bash
curl -s -X POST $API/outcomes -H "x-api-key: $SEAT_KEY" -H "content-type: application/json" \
  -d '{"kind":"enrollment","value_usd":2400,"play":"d2c-search","dedupe_key":"member-8123"}'
```

`dedupe_key` makes reporting idempotent — retries never double-count.

**Set the ceiling** on the channel's policy:

```bash
curl -s -X PATCH $API/wallets/policy -H "x-mgmt-key: $POOL_MGMT_KEY" -H "content-type: application/json" \
  -d '{"wallet_id":"'$POOL_ID'","outcome_kind":"enrollment","cost_per_outcome_ceiling_usd":300,
       "cost_per_outcome_window_days":30,"cost_per_outcome_min_outcomes":5}'
```

From then on `/authorize` computes windowed spend ÷ outcomes under the same
lock as the budget checks: when a spend would push marginal cost-per-outcome
over the ceiling, it **escalates** — a human decides whether to keep buying at
that price, so there's no silent lane past the ceiling and no silent stop
either. `min_outcomes` guards cold starts. The Outcomes dashboard page shows
cost per outcome, per pool, against the ceiling — live.

**Custom throttle logic on top** (optional): anything your learning layer
wants beyond the built-in ceiling — time-of-day aggression, reallocating
budget between channels (`POST /wallets/reallocate` moves cap between sibling
pools atomically, with an audit row), or softening a specific seat — is
management-API mutation, auditable like everything else:

```bash
curl -s -X PATCH $API/agents -H "x-mgmt-key: $POOL_MGMT_KEY" -H "content-type: application/json" \
  -d '{"wallet_id":"'$POOL_ID'","agent_id":"'$SEAT_ID'","daily_spend_budget_usd":1500,"escalate_over_usd":50}'
```

**The kill-switch** is one call, not a loop — freeze stops the wallet and its
entire subtree on every data plane (spend, tools, tokens, gateway, exec) and
unfreeze resumes with nothing lost:

```bash
curl -s -X POST $API/wallets/freeze -H "x-mgmt-key: $ROOT_MGMT_KEY" -H "content-type: application/json" \
  -d '{"wallet_id":"'$POOL_ID'","reason":"CAC breach — pausing paid while we review"}'
```

## 5. What finance sees

- **Live envelopes** — per-pool used/cap/pressure on the Pools dashboard;
  the same numbers via `GET /wallets/stats` per node for your own UI.
- **Channel rollup** — `GET /wallets/tree` returns the wallet tree with spend
  and token cost rolled up per subtree: the chargeback table, one call.
- **Evidence** — every decision (including denials and throttles) carries its
  full context in the audit feed; CSV export for the close. See
  [Evidence & replay](CONCEPTS-EVIDENCE.md).

## Honest edges (today)

- **One outcome kind per pool's ceiling.** A pool's CPO ceiling watches a
  single `outcome_kind`; report multiple kinds freely, but govern one ratio
  per pool (nest pools if you need more).
- **Pooled token caps are daily.** Money envelopes have per-action, daily,
  and monthly horizons; token budgets have daily + monthly per seat but the
  pooled subtree cap is daily-only.

## Reference

- [Quickstart](QUICKSTART.md) · [Gateway](GATEWAY.md) ·
  [Multi-tenant runbook](INTEGRATION.md) (per-customer fleets — same tree,
  different tenancy)
- [Authorization concepts](CONCEPTS-AUTHORIZATION.md) ·
  [Domain glossary](DOMAIN.md) ·
  [OpenAPI spec](https://getsanction.com/api/openapi.json)
