# Demo runbook — the click-paths

> Operating manual for the demo companies (`docs/plans/demo-companies.md`).
> Three fictional clients live in Sanction with a month of real-engine
> history each; this is what to click, in order, with the wow moments marked
> ★. Keys live in `scripts/demo/.keys.<persona>.json` (gitignored) and in
> the `DEMO_KEYS_JSON` GitHub secret — never in the repo.

## Bootstrap (once per target)

```bash
export SANCTION_API_URL=https://getsanction.com/api/v1   # or http://localhost:3000/api/v1
export DEMO_HQ_EMAIL=<owner email for the Demo HQ root>

npx tsx scripts/demo/run.ts seed    meridian      # then coastline, harborwren
npx tsx scripts/demo/run.ts history meridian --days 30   # needs DATABASE_URL (direct DB)
npx tsx scripts/demo/run.ts prime   coastline     # DB-less targets: arms the CPO ceiling via API
npx tsx scripts/demo/run.ts pulse   meridian      # stages today; leaves approvals pending
npx tsx scripts/demo/run.ts status  meridian
```

Run order matters, per target: **seed → history (DB targets) or prime
(DB-less targets, e.g. prod) → pulse**. Coastline's ceiling story *requires*
history or prime before its first pulse. History needs `DATABASE_URL`
for the backdate pass (see `scripts/demo/backdate.ts` for why and what it
touches); seed, prime, and pulse are pure REST. Maintenance beat: the
Bluebird throttle's windowed ratio decays by design (a throttled channel
approves nothing, so its spend ages out) — when the daily pulse flags
Bluebird approved-instead-of-escalated, re-run `prime coastline`. After bootstrapping, bundle the key
files into the `DEMO_KEYS_JSON` secret (recipe in
`.github/workflows/demo-pulse.yml`) — the **Demo Pulse** workflow then
re-pulses all three companies daily, so dashboards always show a live day
and fresh pending approvals. The pulse asserts every decision it stages, so
a red workflow run is a real signal: the demo drifted or prod did.

Entering a company: **`/login` → paste that company's `sk_` key.** You are
now their ops lead — approvals are clickable. Your own login (HQ's owner)
sees every company at once via the subtree views. `SANCTION_WALLET_ID` can
point the public read-only demo at any one company.

## Meridian Analytics — internal AI governance (CFO / platform lead)

The story: departments as pools, seats as people, hard caps that hold.

1. **Pools** — the money shot. $2,000/day org cap, three departments,
   Engineering burning ~87% of its pooled token cap. Narrate runway.
2. **Approvals** — a $140 GPU reservation waits. ★ Run
   `pulse meridian --watch` beforehand, then click **Approve** live: the
   agent redeems the grant and completes the purchase while they watch.
3. **Audit**, range set to 30 days — a month of decisions, per-agent
   rollup with pool attribution, the denied rows (over-cap, blocked
   category) with machine codes. ★ Click **Signed evidence (JSON)**, then
   verify it at `POST /v1/audit/verify` — tamper-evident, self-contained.
4. **Policy → simulation** — replay the real month against a tighter
   draft: sequential mode shows which of last month's decisions would flip.

## Coastline Digital — agency fleet (agency ops)

The story: client channels as pools, spend that answers to bookings.

1. **Pools** — three client channels. Corsair is **frozen** (client paused
   the engagement): one control, all spend stopped, nothing deleted.
2. **Audit** — every spend tagged `channel` / `play`; the answer to "what
   did we spend per client last month, and what did it book?"
3. ★ **The throttle**: Bluebird's cost-per-outcome crossed its $60/booking
   ceiling, so even a $12 charge escalated — the channel auto-throttled to
   human-gated instead of silently burning. It's waiting in Approvals.
4. **Outcomes** — bookings landing against Atlas, the healthy channel.

## Harbor & Wren LLP — regulated practice (managing partner)

The story: tight ladders, clearance, evidence an assessor can hold.

1. **Seats** — ★ point at `contract-agent` (R. Osei, contract): the
   contractor rolled off and the key **fails closed** — show a 401 live if
   they want proof. Rotation and expiry are seat semantics, not process.
2. **Approvals** — a $450 expert-witness retainer and a `docusign.send`
   both wait on the partner. Escalations time out to **deny** (partner
   time: 8h), so nothing dangles forever.
3. **Credentials / Execution** — the docket key injects only under a
   scoped 5-minute JWT to a clearance-3 seat; every access is a row.
4. **Audit** — ★ download the signed evidence export and verify it in
   front of them. That's the assessor conversation, closed.

## The admin tour (your side)

Log in as HQ's owner: **Audit** aggregates every company's subtree —
decisions, burn, secret access with pool attribution; **Approvals →
"Waiting in your pools"** shows every escalation stalled anywhere in the
demo fleet, read-only by design. This is the "help them from my side" view.

## Caveats (learned by running it)

- **Frozen-wallet denials don't persist as decision rows** — the freeze
  check answers before the engine. The denial is real and immediate; just
  don't promise it in the audit feed.
- **The company Overview page reads only its own wallet**, so it shows
  zeros while Pools/Audit are rich (agents live on the pools). Open on
  Pools, not Overview. (Product gap, flagged.)
- **Pulse expectations assume one run per day** — the warm cron does
  exactly that. A second manual pulse the same day can trip the staged
  budget-denial expectations (they're real budgets).
- Pending escalations from pulse self-clean: every persona's policy times
  out escalations to deny, so yesterday's staging never piles up.
