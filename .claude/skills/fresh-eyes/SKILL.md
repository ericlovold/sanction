---
name: fresh-eyes
description: Use when the user says "fresh eyes", "/fresh-eyes", or is about to hand this repo to someone with no context — a Codex sprint, another agent, a new session, a contractor, a reviewer. The inverse of /INPUT — instead of ingesting outside material INTO the project, it exports verified project state OUT to a cold reader, and flags what that reader will trip on that we have gone blind to. Also use before pausing an arc you will not personally resume.
---

# FRESH EYES: the export, and the newcomer's stare

`/INPUT` takes material the user vouches for and routes it into the project.
This is the other direction. Someone is about to open this repo with **zero
context** — a Codex sprint, a different agent, you-in-three-weeks — and
everything that currently lives in a session transcript is about to stop
existing.

Two jobs, and the second is the one people skip:

1. **Export** what a cold reader needs, verified live.
2. **Stare** at the repo the way that reader will, and name what is
   confusing, assumed, or quietly load-bearing.

A handoff that only does (1) is a status report. The value is (2).

## The hard rule: nothing from memory

Every claim in the export is verified against the live system in this run —
`live-state-truth` is not optional here, it is the whole point. A handoff is
read by someone who **cannot check your work**, so a stale claim does not get
caught, it gets acted on. Your own summary of what you did earlier in the
session counts as memory. Re-verify it.

Verify, at minimum, and record the command you used:

- Branch, tip SHA, and whether the branch content differs from the default
  branch. **Squash merges break ancestry** — compare content, not `merge-base`.
- Open PRs and their real state (a merged PR is not an open loop).
- The gate: typecheck, lint, tests — run it, quote the actual numbers.
- Anything the export asserts is "live" — hit it, don't trust the README.
- Published-artifact versions (registries, tags) against what the repo claims.

## Step 1 — fence the sprint

Before describing anything, state what the incoming reader is being handed
and what they are **not**. An unfenced handoff invites the newcomer to
redesign something the user already decided. Write both lists explicitly;
"out of scope" is the more valuable one.

## Step 2 — the export

One self-contained artifact, written for someone who has never seen the
project. Committed to the repo, not left in chat — chat is exactly the thing
that is about to disappear.

Sections that earn their place:

| Section | What it must answer |
|---|---|
| **Ground state** | Branch, SHA, gate numbers, what is deployed, verified how |
| **What just landed** | The last arc, in the reader's terms, not ours |
| **In flight / open loops** | Ranked, each with its next concrete action |
| **Landmines** | The things that will burn a newcomer, with the tell |
| **Decisions that are the user's** | Do not let a cold agent make these |
| **How to get running** | The exact commands that worked, today |

Landmines are the section that repays the whole exercise. A landmine is a
behavior that (a) has already cost someone time, and (b) presents as a
different problem than it is. Give each one its **tell** — the symptom the
reader will actually see — not just the cause.

## Step 3 — the newcomer's stare (the part that gets skipped)

Now read the repo as the outsider. You are looking for what your own fluency
hides. Prompts that work:

- What does the entry point assume you already know?
- What has a name here that means something else everywhere else?
- Which "obvious" step is only obvious because we did it once, months ago?
- What is load-bearing but owned by nobody and documented nowhere?
- Where do two sources of truth disagree? (If they do, that is a finding,
  not a cleanup you do silently — see Boundaries.)
- What would a competent stranger reasonably do here that would be wrong?

Fix the cheap ones inside the fence. Report the rest.

## Step 4 — the blind-spot ledger (the contract)

`/INPUT`'s contract is that nothing fed in vanishes. This one's contract is
that **nothing the outsider needs is left assumed**. End with one line per
finding:

```text
FRESH EYES ledger:
1. gate is green, 1189 tests        → VERIFIED  (npm run check, this run)
2. FORCE RLS reads return nothing   → LANDMINE  (exported, with the tell)
3. prisma generate before anything  → ASSUMED   (was tribal; now in the export)
4. npm token expiry, no owner       → UNOWNED   (flagged, needs a human)
5. keep /about services-framed?     → DECIDE    (user's call, not the sprint's)
6. two docs disagree on pricing     → DRIFT     (reported, /truthsync's job)
```

Statuses: **VERIFIED · LANDMINE · ASSUMED · UNOWNED · DECIDE · DRIFT**.

A ledger with no LANDMINE or ASSUMED lines usually means the stare did not
happen. Handing over a codebase you know well and finding nothing a stranger
would trip on is the least likely outcome, not the best one.

## Boundaries

- **Export, don't refactor.** `scope-fence` applies hard. Fresh eyes see a
  lot; a handoff sprint is the worst possible moment to act on all of it.
  Cheap and inside the fence: fix. Everything else: ledger it.
- **Don't resolve DRIFT here.** Conflicting truth surfaces get reported;
  `/truthsync` drains them as its own pass.
- **Don't decide the user's decisions.** Anything shaped like product,
  pricing, naming, or identity goes in the export as DECIDE, phrased so a
  cold agent knows to stop rather than guess.
- **Public-repo rule.** The export is a committed file: no keys, no live
  wallet ids, no customer names, no private deal terms. If a fact is needed
  to work but unsafe to commit, name the *shape* of it and where it lives
  (env var, secrets store), never the value.
- `ruthless-editor` on the export before you commit it. A handoff nobody
  finishes reading is a handoff that did not happen.
