# Evidence & replay

A log line says what happened. It cannot prove *why*. Sanction is built so
that every decision can be **replayed** — re-run through the same rules over
the same inputs, reproducing the same answer — because that is what turns an
audit trail from narration into evidence.

## The determinism contract

Same request + same policy revision + same state snapshot ⇒ same decision.

That holds because the rules engine is made of **pure functions**: a rule
sees only its context (the request, the policy values, the budget state read
under lock) and returns an effect. All IO — reading state, persisting,
notifying — lives outside the rules. Purity isn't a style preference here;
it is the property every feature on this page rests on.

## Policy revisions

Every policy mutation — API, dashboard, no exceptions — writes an immutable
**revision** snapshot and bumps the policy's revision number. You can always
answer "what did the policy say at 3:14 PM last Tuesday?" — not what it says
now, what it said *then*.

## Decisions carry their context

Every decision records two things alongside its outcome:

- the **revision in force** when it was made, and
- the **exact context** the engine evaluated — the amounts, the limits, the
  budget counters as the rules saw them.

`GET /v1/authorize/{id}/evidence` returns both, re-runs the pure rules over
the stored context, and reports whether the replay **matches** the persisted
outcome. A tampered record fails to reproduce. That is the difference
between "trust our logs" and "check for yourself."

## Time runs in three directions

The same purity powers three questions:

| Question | Surface |
|---|---|
| *What would happen now?* | `?simulate=true` — dry-run a request, nothing persisted |
| *What happened, and can you prove it?* | `GET /v1/authorize/{id}/evidence` — replay with a match verdict |
| *What would have happened instead?* | `POST /v1/policy/simulate` — replay a whole period under a candidate policy |

The last one deserves emphasis: before you tighten a budget, Sanction can
tell you *"under a $500 daily budget, 14 of last week's 212 approvals would
have been denied — these fourteen."* The simulation is honest about its
envelope: counters are held as recorded (`state: "as_recorded"`), fields it
can't simulate are named, and rows it can't replay are counted, never
guessed.

## What's ahead

Replay is today's evidence. Hash-chained, tamper-evident exports are on the
[roadmap](/roadmap) — the progression is deliberate: deterministic first,
replayable second, cryptographic third. Each layer only means something
because the one before it holds.

## Where to go next

- [Authorization: the decision](/docs/authorization) — the lifecycle that
  produces all this evidence.
- [How Sanction works](/architecture) — the one-diagram version.
