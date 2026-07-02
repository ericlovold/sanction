# EPIC: The Control Board for Agent Economics (North Star)

**Status:** North star — vision adopted 2026-07-02. Architecture-shaping now; build is adoption-gated (see Sequencing).
**Opened:** 2026-07-02
**Owner:** Eric (with David)
**Origin:** Crystallized in a public thread with Joshua Hayes (curious builder, not a prospect), who pushed on: unused tokens, cross-department transfer, Sanction learning spend patterns algorithmically, and recommending reallocations/rebalancings. He named the seam because it is really there.

## The one-line north star

Sanction evolves from a **control plane** (yes/no on each agent action) into the **control board for agent economics**: the single deterministic, auditable surface from which a human steers an entire fleet's spend, and where Sanction *recommends* transfers, reallocations, and rebalancings without ever becoming the soft thing in the loop.

## Why we, and why now-ish

We sit at the **authorization chokepoint**. Every spend, token log, and approve/deny already flows through Sanction in a structured, real-time form because the gate forces it to. Nobody else has that vantage. That is the moat: determinism *earns* the data (people trust us at the gate), and the data is what makes optimization possible. This is not a pivot; it is the natural compounding of the position we already hold.

## The arc (three planes, same spine)

1. **Control plane** (today) — deterministic yes/no on each action. Side effect: every action becomes a clean, structured ledger entry.
2. **Observability plane** — that ledger, read as the system of record for all agent economic activity. Already structured because the gate required it.
3. **Optimization plane** — patterns over the ledger: idle budget here, pressure there. Sanction proposes transfers, reallocations, rebalancings, and burn-rate corrections.

## The invariant (do not cross this line)

**The learning layer lives beside the gate, never in it.** The moment an ML/heuristic model sits in the enforcement path, we become the non-deterministic thing we sell against, and we lose the only reason anyone trusts us.

The optimization plane is just our existing governance pattern pointed one level up:

> **Today:** the agent proposes an action → a human/rule disposes at the gate → deterministic enforcement.
> **Optimization:** *Sanction* proposes a reallocation → a human disposes → the **deterministic policy** is what changes → the gate keeps enforcing, hard, as before.

So the recommender does not get a vote either. It only gets to *suggest to a human*. The budget becomes another thing governed the same way actions are: **propose → authorize → deterministic enforcement.**

## How it composes (no new trust model)

A "recommended budget transfer" is just another **PendingApproval** that resolves into a **Grant** — the exact primitive in the ADR-0009 addendum ("Authorization Boundary"). Reallocation reuses the Grant spine we are already building for spend/tool/credential:

- **PendingApproval** — Sanction's recommendation, with reasoning, awaiting a human.
- **Grant** — the approved policy change (a budget move, a new cap), deterministic once issued.
- **Notification adapters** — the same email/webhook/Slack fan-out delivers "approve this reallocation?" the same way it delivers "approve this purchase?".

One spine. The optimizer is a *producer* of PendingApprovals, not a new authority.

## Sequencing (adoption-gated — do not build the optimizer against imaginary data)

You cannot learn from data you do not have. Today: ~2 wallets, both us.

1. **Now — lay the architecture, not the ML.** Keep the ledger clean and complete, hold the determinism boundary, ship the Grant/PendingApproval spine (ADR-0009 addendum). Every action fully structured and attributed.
2. **Gate →** multi-tenant, multi-department spend history exists (real wallets, real cost boundaries — see below).
3. **Then — observability plane.** Read-only economics: where spend concentrates, what sits idle, per-wallet/per-department rollups.
4. **Then — optimization plane.** Recommendations as PendingApprovals. Start with the safest, most obvious moves (idle budget reclaim), earn trust, widen.

**Cost-center hook that exists today:** the **wallet** is the natural allocation boundary. One wallet per client/project/department gives a crude cost center now, without new schema. Formal GL/cost-center coding is a later layer; the wallet is the seam it hangs on.

## Liability discipline

Enforcement is safe ("we applied your rules"). **Advice is a fiduciary-adjacent posture we now own** ("move $5k from marketing to eng"). Every recommendation must be framed as *reasoning + a human's approval logged as the human's decision*. The audit trail has to show the human disposed, not Sanction. That keeps us the instrument, not the fiduciary.

## ICP honesty (two products, one spine)

This is the **hosted-enterprise crown**: cross-department FinOps/treasury for agent fleets. It is *not* the Sanction Local air-gapped small-office spine, which is the near-term revenue. Both share the determinism philosophy and the Grant primitive, so it is one spine, two products. **Fund the vision with the revenue; do not let the shiny far vision starve Local.**

## What "done" would even look like (directional, not committed)

- A human opens one board and sees every agent/department's spend, live.
- Sanction surfaces "3 recommendations" — idle reclaim, an over-pressure cap, a suggested transfer — each with reasoning.
- The human approves one; the deterministic policy updates; the gate enforces the new shape; the whole move is in the audit trail as the human's decision.
- We are the board that governs agent spend economics, not a firewall that blocks a purchase.

## Open questions to carry

- What is the smallest safe first recommendation ("idle budget reclaim" is the candidate)?
- Where does the allocation boundary formalize — stay wallet-based, or add an explicit cost-center/GL dimension, and reconcile against what (NetSuite/QuickBooks/none)?
- Which lands first as a real buyer need: rebilling pass-through, internal ops allocation, or burn-rate control? (Discovery, not assumption.)
