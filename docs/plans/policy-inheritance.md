# Policy inheritance down the wallet tree — design proposal

> Status: **slice 1 shipped** (INHERIT-1, 2026-08-20) — tool + capability
> ladders, per-layer evaluation folded deny > escalate > allow (NOT a rule
> concat: a permissive ancestor must never widen a strict child, which the
> proposed concat would have allowed — caught during implementation).
> Enforced on the REST routes and the AuthZEN PDP; evidence carries the
> deciding layer + consulted revisions; console shows inherited constraints.
> Category/resource lists remain a follow-up; spend thresholds stay
> per-wallet by design. Original proposal below, kept for the record.

## What is true today (verified)

- **Budgets cascade; rules do not.** `subtreeDailyCapUsd` and
  `subtreeDailyTokenCapUsd` (prisma/schema.prisma, Policy) are enforced
  atomically across the subtree at `/authorize` via `lib/cascadeBudget.ts` +
  `lib/walletSubtree.ts` — sibling agents cannot race past a parent's cap.
- **Every other policy dimension is per-wallet.** Category/resource lists,
  tool ladders, capability rules, escalation bands, and freeze live on the
  wallet's own Policy row. A parent cannot push a tool blocklist or an
  escalation band onto children; creating a child wallet starts from that
  wallet's own policy, full stop.
- The one tree-wide non-budget behavior is **freeze**: a frozen ancestor
  denies the whole subtree (`WALLET_FROZEN`).

Anywhere the docs imply "policy nests" beyond budgets and freeze, that is
drift — the honest sentence is "budgets and freeze cascade; rules are
per-wallet."

## The decision to make

Should a parent be able to impose *rules* (not just caps) on descendants?
The enterprise ask is real: "no child of Engineering may call
`payments.charge`, whatever its local policy says."

## Proposed shape (if yes)

**Inheritance as evaluation-time overlay, not copy-down.**

- Add optional `inheritedRules` semantics: at decision time, the enforcement
  shell (which already pre-fetches wallet + subtree state) also fetches
  ancestor policies and concatenates rule lists **ancestor-first** into the
  pure engine's ordered ladder. Deny-overrides already folds correctly —
  an ancestor block cannot be undone by a child allow, because the engine
  resolves deny > escalate > allow across the whole list.
- **No schema copy, no sync jobs.** Copying rules into children at edit time
  breaks the revision story (which revision was in force?). Overlay keeps
  each wallet's policy revision chain intact; the decision's stored context
  records every revision consulted (parent + own), so evidence replay stays
  deterministic.
- **Budget fields do not inherit** — they already cascade through counters;
  overlaying them would double-enforce.
- Scope the first slice to **tool and capability ladders** (list-shaped,
  order-preserving, already prefix-glob). Category/resource lists follow the
  same pattern later. Escalation bands should *not* inherit in v1 — money
  thresholds are the piece owners most explicitly tune per team.

## Costs

- One extra policy fetch per ancestor at decision time (bounded by tree
  depth; trees are shallow — cacheable alongside the existing subtree read).
- Evidence context grows: it must store the full consulted revision set.
- Console must render "inherited from <parent>" on the policy page or
  operators will file the denial as a bug.

## Determinism check

Passes: same request + same set of policy revisions (own + ancestors) +
same state snapshot ⇒ same decision. The rules stay pure; only the context
assembly in the shell grows. This is ADR-0009-compatible.

## Do-nothing alternative

Document current behavior honestly (done in this doc and the README pass)
and rely on subtree caps + freeze for tree-wide control. Acceptable while
fleets are single-team; weakens as wallet trees map to org charts.
