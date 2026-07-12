# Demo companies — fictional clients, real engine

> Build spec for the demo-accounts arc (DEMO). Captured from Eric's direction
> 2026-07-12: fully-loaded mock client accounts inside production Sanction —
> "all dummy token data, but let's make it test: pass data from A to B" — that
> he can click through end-to-end, demo to clients, and oversee as admin.
> Verified against shipped mechanisms before writing.

## The idea

Two or three fictional companies live in Sanction as real accounts. Their
agents drive real traffic through the real engine — authorizations across the
whole ladder, gateway token metering, escalations, grants, outcomes,
credential injections. Every dashboard page is genuinely populated because
the data took the same path a client's data takes. Nothing is stubbed;
the audit chain exports and verifies, evidence replays, simulation has a
real history to replay against.

This is simultaneously: the sales demo, a standing end-to-end test of the
whole product (smoke.sh, but *alive*), and the operator-training environment.

## Mechanisms (all shipped — verified 2026-07-12)

| Need | Shipped mechanism |
|---|---|
| Build an org tree via API | `POST /v1/wallets` with `parent_id` + parent `sk_` — nested creation skips the IP rate limit |
| Enter a company as its owner | `/login` accepts a raw management key (`app/login/actions.ts`) — full interactive session, approvals clickable |
| Admin view across all demo companies | ORG-VIS: the root owner's Audit page aggregates the whole subtree; Approvals shows "waiting in your pools" |
| Public read-only demo | `SANCTION_WALLET_ID` env → demo view renders `/dashboard` without login |
| Drive the full loop from outside | `scripts/smoke.sh` already exercises wallet→agent→policy→ladder→tokens→gateway→vault→exec/inject via pure REST |
| Live agents misbehaving on stage | `examples/eve-testers` — shopper/researcher/operator/redteam fleet over sanction-mcp |

## Architecture

```
Sanction Demo HQ  (root wallet, Eric's sign-in email → claim-by-email)
├── Meridian Analytics      (fictional client 1 — its own subtree)
├── Coastline Digital       (fictional client 2)
└── Harbor & Wren LLP       (fictional client 3)
```

- **Eric's admin side** = log in normally; HQ's console sees every company's
  decisions, burn, and waiting escalations via the shipped subtree views.
- **The client demo** = `/login` with that company's `sk_` key → you *are*
  Meridian's ops lead: their pools, their approvals inbox (approve live on
  stage), their audit trail. One immersive account per story.
- **The website demo** = point `SANCTION_WALLET_ID` at one company for the
  public read-only view.

## The three companies (persona = story = pack)

1. **Meridian Analytics** — *internal AI governance* (the primary use case).
   Departments as pools (Engineering / Marketing / Support), seats with named
   holders, gateway token metering, subtree daily token caps. Staged state:
   Engineering at ~85% of its pooled cap, one seat over its daily line
   (denied, rich remediation visible), chargeback story in the reporting CSV.
   Buyer on the other side of the desk: CFO / platform lead.
2. **Coastline Digital** — *agency fleet*. Pools as client channels,
   attribution tags on every spend, outcomes logged (`sanction_log_outcome`),
   one channel throttled by its cost-per-outcome ceiling, one channel frozen
   (kill switch). Buyer: agency operations.
3. **Harbor & Wren LLP** — *regulated practice*. Compliance-baseline pack,
   vault credentials with clearance levels, a contractor seat already expired
   (fail-closed on stage), escalations pending, and the closer: download the
   signed audit export and verify it live. Buyer: managing partner. Ties to
   the Local narrative and the queued guest-seats lane.

## The driver — `scripts/demo/`

TypeScript, run with `tsx`; persona manifests are data files, the engine is
one program. Talks REST only — the same surface a customer touches.

- **`seed <persona>`** — build the company: child wallet, pools, policies
  (from the pack catalog + persona overrides), seats with holders/expiries,
  vault entries (fake secrets), webhooks off. Idempotent: re-run finds by
  name and completes what's missing. Writes keys to a gitignored
  `scripts/demo/.keys.<persona>.json` — never committed.
- **`pulse <persona>`** — a day-in-the-life: N gateway/token logs across
  seats, spends across the ladder (auto-approved, escalated, denied,
  blocked-category), tool authorizations, an exec→inject round-trip, an
  outcome or two. **Leaves the stage set**: 1–2 escalations pending, so
  every demo starts with something to approve. A `--watch` flag polls
  pending grants and completes the purchase when Eric clicks approve —
  the live A→B moment.
- **`history <persona> --days 30`** *(PR2)* — depth for reporting/simulation:
  drive traffic via API, then spread `createdAt` across the window with a
  direct-DB pass. Fabrication-lite, clearly quarantined: audit exports chain
  at export time so they still verify; evidence replays from stored context
  regardless of timestamp. Verify counter-table coherence locally before
  ever running against prod.
- **`pulse --all` on a schedule** *(PR3)* — a cron keeps the demos warm so
  the dashboards always show a live pulse without a pre-demo scramble.

## Hygiene

- Names are unmistakably fictional; every wallet name is prefixed
  (`Demo — Meridian Analytics`) so demo data can never be confused with a
  real client in ops queries.
- Keys live in the gitignored keys files / password manager — never in the
  repo, per the standing rule.
- Wallet-creation rate limit is a non-issue: HQ is created once by hand;
  everything else nests under HQ's `sk_` (authenticated, unthrottled).
- Demo wallets are ordinary tenants: RLS and membership gating isolate them
  like anyone else. No special-case code in the product for demos —
  if a page looks empty, that's a product gap the demo just found.

## PRs

- **PR1 — seed + pulse + Meridian.** The driver skeleton, persona manifest
  format, and the internal-governance company fully staged. Success: run
  `seed meridian && pulse meridian` against local dev → log in with the
  printed `sk_` → pools show burn, approvals has 2 pending, audit is
  populated; `npm run check` green.
- **PR2 — history mode + the other two personas.** 30-day depth; Coastline
  (outcomes/ceiling/freeze staged) and Harbor & Wren (expiry/vault/evidence
  staged). Success: reporting page shows a real month; simulation sequential
  replay returns non-trivial deltas; audit export verifies.
- **PR3 — warm cron + demo runbook.** Scheduled pulse; `docs/DEMO-RUNBOOK.md`
  — the click-path per persona (what to show, in order, with the wow moments
  marked), including the admin-side subtree tour.

## Open questions

1. **Prod from day one, or local shakedown first?** Recommend: PR1 verified
   against local Postgres, then the same driver runs against
   `getsanction.com` to create the real thing (it's REST-only, so nothing
   changes but the base URL and keys).
2. **HQ ownership email** — Eric's primary sign-in email claims one root
   wallet by unique `ownerEmail`. If that email already owns the real
   operating wallet, HQ needs its own address (or HQ nests under the
   existing root). Decide at seed time; the driver takes it as input.
