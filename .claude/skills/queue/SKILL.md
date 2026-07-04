---
name: queue
description: Use when the user says "queue", "/queue", "add to the backlog", "capture this", or drops a thought/idea/question mid-arc that should NOT derail the current work. Appends the item to docs/BACKLOG.md with a date and moves on. With no argument, shows the open backlog. This is capture, not analysis - the point is to not lose the thought AND not lose the thread.
---

# queue: capture the thought, keep the thread

Mid-arc ideas are load-bearing and fragile: interrupt the work to chase them
and you lose the arc; ignore them and you lose the idea. Queue does neither.
The user says it, you write it down, you go back to what you were doing.

## Capturing (the 30-second contract)

1. Append to `docs/BACKLOG.md`, newest on top, using the entry format below.
2. Keep the user's own words where possible - the phrasing carries intent.
3. If the item is a question the current session can already answer from
   work done this arc (research fresh in context), give a SHORT take in chat
   after capturing - three sentences, a recommendation, done. Do not open a
   research thread; if it deserves one, that is a future arc and the entry
   says so.
4. Return to the interrupted work in the same turn. Queue never ends a turn
   as the main event.

## Entry format

```text
- [ ] 2026-07-04 — Should we make the repo private? (question, from Eric,
      market-intel arc) · take delivered in-session: stay source-available
```

- Checkbox = open/closed. Closing states: answered, promoted (became a
  roadmap item, task, or PR), or dropped - say which when you check it off.
- One entry, one line-ish. If it needs a paragraph, it needs an arc, not a
  backlog line; capture the one-liner and note "needs an arc".
- Date every entry (memory-hygiene applies: undated ideas rot unnoticed).

## The public-repo rule

This repo is public. The backlog is therefore public. Phrase every entry so
it can be read by a competitor, a customer, and a design partner at once:

- Strategy questions are fine in the abstract ("evaluate repo visibility"),
  NOT with the reasoning that makes them sensitive ("because X told us Y").
- Names, customer signals, revenue specifics, and market-intel sources stay
  in chat. If the substance can't be phrased safely, the entry is a
  generalized placeholder and the substance lives in the conversation.

## Draining

The backlog is an input to `/zoomout` (open loops, step 3) - queued items
surface there ranked against everything else. Don't drain the queue inside
this skill; that's exactly the derailment queue exists to prevent.
