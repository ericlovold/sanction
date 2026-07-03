---
name: zoomout
description: Use when the user says "zoom out", "where do we stand", "what's next", or a work arc just closed (PRs merged, feature landed) and the next move is unclear. Pulls up from the trench - re-reads the live repo state, README, roadmap, and changelog - then delivers a ranked view of next best actions. Not for mid-task status checks; this is the strategic altitude, called between arcs, not during one.
---

# zoomout: pull up, re-read the board, pick the next move

Deep work narrows vision by design. After enough consecutive tasks, the map in
your head is a memory, not a map. Zooming out means rebuilding it from live
state before choosing what matters next - because the repo moved, main moved,
and the roadmap may now be describing a product that already shipped.

## Step 1 - resync to live state (never answer from session memory)

Run the reads fresh, every time. This session's recollection of main is stale
by default (live-state-truth applies to your own memory too):

- `git fetch origin && git log --oneline <last-known>..origin/main` - what
  landed since you last looked, including work you didn't do.
- Open PRs and their CI state; unmerged branches carrying real work.
- The working tree: anything uncommitted or half-done in this session.

## Step 2 - re-read the product's claims

In this repo, truth lives in four places. Read all four, current versions:

| Surface | What it claims | File |
|---|---|---|
| README | What the product is | `README.md` |
| Roadmap | What we promise next (Now leads by ~one release) | `lib/roadmap.ts` |
| Changelog | What we say we shipped | `lib/changelog.ts` |
| Traceability | What is actually proven, and the honest gaps | `docs/TRACEABILITY.md` |

## Step 3 - cross-check for drift

The valuable output of a zoom-out is the deltas, not the summary:

- **Roadmap lag**: is anything in "Now" already shipped? (It happens fast here.)
- **Changelog gaps**: did something land on main with no public entry?
- **Claim drift**: does README/site copy describe features that changed?
- **Open loops**: unsent emails, undecided questions, customer signals waiting
  on an answer, branches that should merge or die.

## Step 4 - deliver the board, then a decision

Present, in this order and briefly:

1. **WHERE WE ARE** - what shipped since the last zoom-out, one line each.
2. **DRIFT** - each mismatch found in step 3, with the one-line fix.
3. **OPEN LOOPS** - things waiting on a human, oldest first.
4. **NEXT BEST ACTIONS** - at most five, ranked, each with why-now. Mark ONE
   as the recommendation. Business actions (the unsent email, the pilot
   decision) rank against engineering actions, not below them.
5. **NOT NOW** - what you are explicitly deferring, so deferral is a decision.

End by asking which action to take, unless the user already said. A zoom-out
that ends in a wall of analysis instead of a chosen next move has failed.

## Rules

- Fresh reads only. If you did not run the command this zoom-out, you do not
  cite its output.
- The roadmap file's own principle governs: "Now" leads the product by about
  one release and never lags it. Flag violations; fix only when asked
  (scope-fence applies).
- Customer signal outranks internal polish in the ranking unless something is
  on fire.
