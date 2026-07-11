# Connector-grade onboarding — enable, scan, seat, govern

> Build spec for the MCP-vision arc (ONBOARD). Captured from Eric's direction
> 2026-07-11, with Apollo.io's connector experience as the reference. Phases =
> PR order. Verified against the shipped schema and backlog before writing —
> every phase names the primitive it builds on.

## The vision

Enabling Sanction in an MCP host (Claude, ChatGPT, any connector directory)
should feel like enabling Apollo or GitHub: one click, OAuth, done. Then the
first-run conversation does what a sales-grade onboarding does:

1. **"Want me to scan your organization for AI seats and licenses?"** — the
   scan doubles as shadow-AI discovery: who's using what, on whose card.
2. **Autofill-grade recommendations** — "we noticed this across your org
   chart; here's a seat assignment plan": departments as pools, people as
   seats, budgets from observed usage, a channel pack per team. Apply in one
   click.
3. **The manual path keeps the data** — an owner who says "no, I'll build my
   teams one at a time" still gets the raw scan: browse the roster, assign
   seat by seat. Manual mode is a different UI over the same snapshot, not a
   degraded experience.

## Why this is closer than it looks

The governance side of the vision is **already shipped**; what's missing is
the ingestion front door and the recommendation layer:

| Vision needs | Shipped primitive | Where |
|---|---|---|
| Seats you hand to people | SEATS-1: holder, expiry, rotation, batch creation from a template | `Agent` model + seat semantics (`prisma/schema.prisma`), `docs/DOMAIN.md` |
| Departments with hard budgets | Wallet tree + subtree daily spend/token caps | `lib/cascadeBudget.ts`, `lib/walletSubtree.ts`, `Policy.subtreeDailyCapUsd` |
| Governed license/seat purchases | Provision ladder | `POST /v1/authorize/provision`, `lib/rules/provision.ts` |
| Per-team starting policies | Channel policy packs + 30-day simulation preview | PACK-1 catalog |
| Kill switch | Wallet freeze (KILL-1, ancestor walk) | shipped on main |
| The connector on-ramp itself | Hosted remote MCP endpoint — **already promoted** (2026-07-08) as the enterprise on-ramp and Sanction-owned enforcement point | `docs/BACKLOG.md` |

**The unlock that keeps this small: the host's own connectors are the
scanner.** An org that enables Sanction inside Claude or ChatGPT has already
granted that host its directory surfaces — Google Workspace, Slack, HRIS,
Apollo. Sanction does not build N directory integrations for v1. It defines a
normalized snapshot contract; the governed agent gathers via the connectors
the org already trusts and submits the result. Identity stays upstream
(engineering principle #1) — Sanction consumes the snapshot, mints governed
runtime identity (seats), and is never an identity of record.

And the arc dogfoods: **applying a seat plan is itself a provision action.**
A 40-seat autofill goes through `/authorize/provision` like any other
resource allocation — big plans escalate to the owner, approval mints a
grant, the plan applies on retry. Onboarding runs through the product's own
approval loop, which is the demo.

## The do-nothing wedge: observe mode

Adoption strategy (Eric, 2026-07-11): **the easiest way to get people to
implement is to make them do nothing.** After connect + scan, the org gets
value with zero governance assigned — no seats, no budgets, no policy
decisions to make:

- **Scan alone tells you a thing** — the shadow-AI findings are the latent
  value, delivered before any commitment.
- **Observe mode is monitoring plus recommendations** — traffic routes
  through Sanction, every would-be decision is computed and logged, nothing
  is ever blocked. The org watches the board fill in.
- **Migration is at their leisure** — flip a pool at a time from observe to
  enforce, on their schedule or at compliance checkpoints. The maturity
  ladder (`lib/readiness.ts` LEVELS, Shadow AI → Evidenced AI) becomes the
  migration UI, not just sales framing — partially closing the queued
  "maturity model as sales framing" backlog item.

The upsell is evidence, not marketing: observe mode accumulates **real
decision contexts**, and simulation (SIM-1/SIM-2) already replays stored
contexts against a draft policy. So the recommendation reads "last week,
this pack would have escalated 3 actions and denied 1 — here they are,"
computed deterministically from the org's own traffic. The readiness
diagnostic already prescribes exactly this as the Shadow-usage first
workflow ("metering gate, no blocking — govern once you can see") and the
`metering-first` pack exists; observe mode makes the prescription real for
actions, not just tokens.

**Positioning guard.** "Preventive, not observability" stays canonical:
observe is an explicit, visibly-labeled on-ramp to enforcement, never a
silent default for a wallet that chose governance. Fail-closed is untouched
for enforcing wallets; every monitoring digest ends with the flip-to-enforce
action.

## Vocabulary (extends `docs/DOMAIN.md` when shipped)

- **Roster** — a point-in-time, normalized snapshot of upstream org data:
  people, teams, and observed AI tools/licenses/spend. Staging data with
  provenance per entry (which connector, when). Never identity of record,
  never authenticates anyone.
- **Seat Plan** — a deterministic draft mapping a roster to governance:
  pools, seats, budgets, packs, with a rationale per line. A pure function
  over (roster, options) — same inputs, same plan (engineering principle #3),
  so recommendations are replayable and evidenced like decisions.
- **Shadow-AI findings** — the observed-usage slice of the roster, reported
  on scan regardless of whether a plan is ever applied. The scan has
  standalone value.
- **Observe mode** — shadow enforcement, per wallet: the engine computes and
  persists the full decision (same rules, same determinism), marks the
  request observed, and returns allow with the would-be decision attached.
  Nothing blocked, everything seen. The audit trail records what *would*
  have happened, which is what the migration recommendation is built from.

## Phases

### PR1 — Roster ingestion (schema + management-plane API)

- Prisma: `OrgRoster` (wallet-scoped, versioned snapshots) with normalized
  children `RosterPerson`, `RosterTeam`, `RosterObservedTool` — normalized
  because PR2's engine queries them; each row carries `source` provenance.
- `POST /v1/org/roster` (mgmt-plane, validate + store a snapshot; idempotent
  by content hash) and `GET /v1/org/roster` (latest snapshot + shadow-AI
  findings summary).
- `lib/roster.ts` — the zod contract, shared by REST and dashboard actions
  (mirror the `lib/policy.ts` single-validation-point pattern).
- **RLS on roster tables from day one** — this is PII; extend the SEC-3
  `withTenant` pattern rather than joining the decision-spine RLS backlog
  item's queue.
- Tests: unit with mocked prisma per convention; a `*.db.test.ts` for RLS
  isolation.

### PR2 — Seat Plan engine (pure lib + preview API)

- `lib/seatPlan.ts` — pure: `(roster, options) → { pools[], seats[],
  budgets, packs, rationale[] }`. No IO, unit-tests without a DB, like
  `lib/evaluation.ts`.
- Heuristics v1 (deliberately simple, deterministic): team → child-wallet
  pool; person with observed AI usage → seat (holder = person); budget =
  observed spend × configurable headroom, else pack default; channel pack
  matched per team profile. Every line carries its rationale ("2 ChatGPT
  licenses observed via Google admin → seat, $15/day from gateway-token-
  budget pack").
- `POST /v1/org/plan/preview` — **no writes** (mirror the simulation
  preview's honesty pattern: show what would happen, name what's ignored).

### PR3 — Apply + the manual path (console)

- `POST /v1/org/plan/apply` — transactional batch create (child wallets +
  policies + seats via SEATS-1 batch creation), **governed**: the apply is a
  provision request, so plan size × unit cost rides the existing ladder and
  escalates by policy. Accepts a line subset, so "apply all" and "apply
  these three" are the same endpoint.
- Dashboard: an onboarding/review surface — recommendation cards with
  accept / edit / skip (the autofill), plus a manual tab that browses the
  roster and assigns one seat at a time. Same patterns as console-parity:
  server components + co-located `actions.ts`, cookie-authed, never the
  header-authed API routes.

### PR4 — MCP surface (the conversational onboarding)

- New tools in `mcp-server.ts`:
  - `sanction_submit_roster` — the agent gathers org data through the host's
    connectors and submits the normalized contract.
  - `sanction_preview_seat_plan` — returns the draft plan + shadow-AI
    findings for the agent to present.
  - `sanction_apply_seat_plan` — rides the grant loop (`renderAuthResult`
    already unifies the escalate → poll → retry-with-grant UX).
- The Apollo-like first-run experience is **prompt-shaped, not host-specific
  code**: tool descriptions teach the flow ("on first setup, offer to scan
  the organization…"), so it works in any MCP host on day one.

### Track B (parallel) — connector-grade connect

The carrier for all of the above: the **hosted remote MCP endpoint**
(Streamable HTTP + OAuth onboarding) already promoted in the backlog. This
arc gives it its killer first-run moment; directory listings and the
install-instrumentation / install-center backlog entries bind in as the
distribution half. stdio/npx keeps full parity — PR4's tools work there too.

### Track C — observe mode (the do-nothing wedge)

Independent of the roster/plan track; either can ship first, together they
compound (a seat plan can be applied *in observe mode*, so even "apply"
commits to nothing).

- **C1 — engine mode.** `Policy.enforcementMode: enforce | observe`
  (default `enforce`; fail-closed untouched). In observe, the shell runs the
  identical rule fold, persists the decision with an `observed` marker, and
  returns allow carrying the would-be decision (`would_be: denied,
  PER_TXN_LIMIT`). Per-wallet, so migration flips pool by pool. Escalations
  in observe mode do not page anyone — they log.
- **C2 — the monitoring digest.** A dashboard surface (and later a webhook
  digest) over observed decisions: what ran, what would have escalated or
  been denied under the current draft policy, spend/token totals — each
  recommendation backed by the simulation replay over the org's own
  contexts, each pool row ending in one action: **flip to enforce**.

## Guardrails

- **Identity stays upstream.** The roster is staging with a refresh story,
  not a directory. Sanction never becomes the org chart.
- **Determinism.** The recommendation engine is pure; an applied plan is
  reproducible from its roster snapshot + options. No LLM in the engine —
  the LLM gathers and presents; Sanction decides.
- **Fail closed.** Plan application is a governed provision like any other.
- **Consent + provenance.** The agent gathers only through connectors the
  org already granted; every roster row records its source. The scan is
  read-only until a human applies a plan.

## Success criteria (executable, per phase)

- PR1: `npm run check` green; `npm run test:db` proves roster RLS isolation;
  `POST /v1/org/roster` round-trips a fixture snapshot.
- PR2: `npx vitest run tests/seatPlan.test.ts` — same fixture roster twice →
  byte-identical plan; preview endpoint writes nothing (assert row counts).
- PR3: seeded roster → apply → seats/pools exist and an oversized plan
  escalates (assert a `PendingApproval`); dashboard verified by rendering
  per the session-ops note.
- PR4: `npm run build:mcp` bundles; a scripted MCP client submits a roster,
  previews, applies through an escalation, and lands seats.
- C1: unit tests prove an observe-mode wallet gets `authorized: true` with
  the would-be decision attached, the persisted request carries the observed
  marker, and an enforce-mode wallet's behavior is byte-identical to today.
- C2: seeded observed traffic renders the digest with at least one
  would-have-denied line and a working flip-to-enforce action.

## Out of scope (this arc)

- Native directory integrations (Sanction's own Google Workspace / Okta /
  SCIM OAuth) — later, if connector-gathered rosters show demand for
  first-party sync.
- Continuous sync / drift detection (re-scan diffs, "3 new hires since last
  scan") — follow-up once the snapshot flow proves out.
- Roadmap/storefront copy — `lib/roadmap.ts` leads by one release; it picks
  this up when PR1 is shipping, not before.

## Open questions for Eric

1. **First slice:** PR1→PR4 as ordered, or pull PR4's `sanction_submit_roster`
   forward with a thin JSONB store so the conversational scan demos sooner?
   (Recommended: as ordered — the engine is the moat; a demo without apply
   is a mockup.)
2. **Roster retention:** TTL on snapshots (30/90 days) vs. keep-forever with
   the audit trail? PII argues for a TTL.
~~3. Seat invitations~~ — **resolved 2026-07-11 (Eric): owner-driven.**
Sanction never contacts seat holders at plan-apply time; holders learn
about their limits, credentials, and updates through the account and the
owner's actions. Key distribution is the owner's ceremony. (This also keeps
PR3 free of any email/notification dependency.)
