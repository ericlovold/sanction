# Funnel instrumentation

**Why.** Real landing traffic, near-zero wallet conversion (Eric, 2026-07-20). We
were guessing where visitors leak. This wires the whole path as Vercel Analytics
custom events so we can *see* the drop-off instead of guessing, and judge every
later conversion change against it.

**Source of truth:** `lib/funnel.ts` — event names live there, not as inline
strings, so the funnel in the Vercel dashboard and the firing code can't drift.
`tests/funnel.test.ts` pins the names (rename one → CI fails loudly).

## The events

| Stage | Event | Fires from | Props |
|---|---|---|---|
| Landing engagement | `landing_cta` | `components/track-cta.tsx` on hero + nav CTAs | `location` (hero/nav), `target` (start/talk) |
| Demo opened | `demo_view` | `components/funnel-beacon.tsx`, mounted on the demo dashboard | — |
| Demo engaged | `demo_decision` | `app/dashboard/demo-actions.ts` (server) when a visitor approves/denies a live escalation | `decision` (approve/reject) |
| Tour started | `tour_started` | `app/dashboard/onboarding-tour.tsx` | `trigger` (auto/relaunch) |
| Tour completed | `tour_completed` | same, "Done — it's yours" only (not Skip) | `via` (done) |
| **Conversion** | `wallet_created` | `components/create-wallet.tsx` + `app/start/actions.ts` + API (pre-existing) | `source`, `channel` |
| Activation | `first_gateway_call` | `components/gateway-watch.tsx` (pre-existing) | `model` |

`FUNNEL_PATH` is the main conversion sequence: `landing_cta → demo_view →
demo_decision → wallet_created → first_gateway_call`. The two tour events are an
*assist* (did completing the tour lift wallet creation?), not a required step.

## How to read it in Vercel

Project → Analytics → Events shows counts per custom event. To build the funnel,
compare successive stages in `FUNNEL_PATH` — e.g. `demo_view` → `demo_decision`
is "did they actually touch the demo," and `demo_decision` → `wallet_created` is
the money question: does governing a live agent make them sign up. Attribution
props (`location`, `channel`) split each stage by source.

## Notes

- All `track()` calls are best-effort and guarded — an ad-blocker or a thrown
  analytics call must never block a navigation or a decision.
- Demo events fire only for the demo wallet (anonymous), so they don't mix with
  signed-in usage; `demo_view` is gated on `isDemo` in the dashboard.
- `wallet_created` and `first_gateway_call` predate this work and keep their
  names for data continuity.
