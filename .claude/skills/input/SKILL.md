---
name: input
description: Use when the user says "INPUT", "/INPUT", or feeds in a block of raw material they vouch for — strategy notes, sprint output, a roadmap enhancement, a code snippet, or live coding suggestions for work in flight. Unlike /queue (one-liner capture, no analysis), INPUT is ingestion with judgment - read it all, split it into pieces, route each piece to where it lives, apply what's live, and report a disposition for every piece. Nothing fed in gets silently dropped.
---

# INPUT: more input, Johnny 5

The user has raw material they already know is good — the vouching is the
signal. Your job is not to re-litigate whether it's valuable; it's to read
fast, think anyway, and put every piece where it belongs. Disassemble the
payload, not the day.

## Step 1 — read the whole payload first

No partial application. Strategy context at the bottom can change what a
snippet at the top means. Read everything, THEN act.

## Step 2 — split and classify

Break the payload into distinct pieces. Each piece is one of:

| Class | Destination |
|---|---|
| **Live** — a suggestion/snippet for work currently in flight | The working tree, this arc |
| **Later** — roadmap enhancement, strategy, feature idea, snippet with no live target | `docs/BACKLOG.md` (queue entry format) |
| **Durable** — a working-style rule, convention, or lesson that outlives any arc | Propose an `AGENTS.md` edit |
| **Sensitive** — names, deals, sources, private reasoning | The conversation only — never a committed file |

One payload usually contains several classes. Classify per piece, not per
payload.

## Step 3 — act by class

- **Live pieces**: verify against the live code before applying
  (live-state-truth — the suggestion was written against someone's mental
  model, not necessarily the file as it is now). Apply what survives, fenced
  to the current arc (scope-fence), and run the relevant gate. If a piece is
  wrong for this codebase, PUSH BACK with the reason — INPUT is ingestion
  with judgment, not dictation. Johnny 5 reads fast; he still thinks.
- **Later pieces**: distill each to a dated backlog entry in /queue's format
  and public-repo phrasing. Keep the user's words where they carry intent.
  Do NOT start the new arc — INPUT never turns into a pivot unless the user
  says "now". Roadmap-shaped pieces become backlog entries flagged
  "(roadmap candidate)"; `lib/roadmap.ts` itself changes only on request.
- **Durable pieces**: draft the AGENTS.md addition and show it — the user
  approves durable memory (memory-hygiene applies: dated, phrased to
  survive time).
- **Sensitive pieces**: acknowledge what you're holding and where the safe
  generalized placeholder went, if any. The substance stays in chat.

## Step 4 — the disposition report (the contract)

End with one line per piece — nothing fed in vanishes:

```text
INPUT disposition:
1. retry-backoff snippet        → APPLIED   (lib/gateway.ts, tests green)
2. Q3 channel-pack idea         → QUEUED    (backlog, roadmap candidate)
3. "always gate deploys" rule   → PROPOSED  (AGENTS.md draft above, awaiting ok)
4. prospect pricing detail      → HELD      (sensitive - conversation only)
5. switch-to-polling suggestion → PUSHED BACK (webhooks already cover this; see note)
```

Statuses: APPLIED · QUEUED · PROPOSED · HELD · PUSHED BACK. A payload where
everything lands as QUEUED is fine; a payload with no disposition report is
a failed INPUT.

## Boundaries

- INPUT feeds the current arc or the backlog — it does not open new arcs,
  end turns as the main event when work was interrupted, or edit truth
  surfaces (roadmap, README claims) on its own authority.
- The public-repo rule from /queue governs every committed byte.
- Voice-fence still applies: if a piece is copy a human will read as the
  user's own words, coach it, don't write it.
