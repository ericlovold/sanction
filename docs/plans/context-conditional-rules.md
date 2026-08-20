# Context-conditional rules — design proposal

> Status: **slice 1 shipped** (COND-1, 2026-08-20) — `outside_hours_utc` +
> `after_model_calls_today` on the tool ladder, one predicate per rule,
> restrictive effects only, signals captured once by the shell and persisted
> in evidence, conditions riding the INHERIT-1 layers. One correction from
> this proposal: the counting signal shipped as **model calls today**, not
> `maxDecisionsPerDay` — allowed tool calls are decision-only (never
> persisted), so a decisions counter would be blind to exactly the runaway
> loops it targets. Simulate boundary: the tool ladder predates SIM-1's
> simulatable set; candidate `tool_conditions` echo back in `ignored_fields`.
> Original proposal below, kept for the record.

## The ask

Rules that combine signals: "approve research-tool spend up to $10, but only
while this agent has made fewer than N tool calls this hour," "allow
`payments.charge` only during business hours," "tighten the escalation band
when the seat's denial rate is climbing."

## What is true today (verified)

- Rules are **pure over their context** (`lib/evaluation.ts`; ADR-0009). The
  enforcement shell pre-fetches exactly the state a ladder needs (budget
  counters, grant, freeze) into the context and runs the fold inside an
  advisory lock.
- Each ladder tests one dimension per rule (amount thresholds, category
  lists, tool ladders, capability patterns). There is no cross-signal
  predicate, and nothing in the engine prevents one — the limitation is
  what the shell puts in the context.

## Design position: grow the snapshot, not the engine

The engine does not need a DSL, an expression language, or eval. It needs a
**richer, still-deterministic context** plus rules that read it:

1. **Name the admissible signals.** v1 candidates, all already derivable
   from persisted state the shell can pre-fetch under the same lock:
   - `decisionCountsToday` per action type (from `AuthorizationRequest`)
   - `tokenCostToday` (already fetched for budget rules)
   - `requestAt` — wall-clock of the request, already persisted, enabling
     time-window rules with zero new state
2. **Policy shape:** a rule gains an optional `when` object of bounded,
   typed predicates (`maxDecisionsPerDay`, `withinHours: [start, end]`, …)
   — a closed vocabulary validated in `lib/policy.ts`, not a free
   expression. Closed vocabulary = simulable, documentable, and immune to
   injection through policy edits.
3. **Determinism holds** because every signal is part of the stored decision
   context: evidence replay re-reads the recorded snapshot, never the live
   clock or counters. `requestAt` enters the context once, at the shell.

## Explicitly rejected

- **Free-form expressions / CEL / JS snippets in policy** — breaks the
  closed-vocabulary guarantee, makes simulation and evidence explanation
  unbounded, and turns policy edits into code execution.
- **Rules doing IO** ("check the current rate") — violates the purity
  contract that makes replay and `/policy/simulate` trustworthy.

## Interactions to design before building

- `/policy/simulate` must replay conditional rules against **recorded**
  context; historical decisions made before a signal existed won't carry it
  — simulation needs an explicit "signal absent" semantics (skip the
  predicate vs. fail closed) decided per signal, and reported in the diff.
- The console policy editor needs to render `when` clauses legibly or the
  feature ships as YAML-only power-user surface — worse than not shipping.

## First slice, if approved

`withinHours` + `maxDecisionsPerDay` on the **tool ladder** only: two
predicates, one ladder, full simulate + evidence coverage, console rendering
read-only. Everything else waits for that slice to prove the pattern.
