---
name: truthsync
description: Use when ships have outrun the public story - merged PRs with no changelog entry, roadmap "Next" items that already shipped, README claims that drifted - or on request ("truthsync", "drain the drift") and as a pre-release sweep. Diffs merged work since the last drain against the truth surfaces (changelog, roadmap, README, DOMAIN, TRACEABILITY) and proposes the catch-up as one PR. /zoomout detects this drift; /truthsync fixes it.
---

# truthsync: the story catches up to the ships

This repo ships faster than it narrates. The roadmap's own principle — "Now
leads the product by ~one release and never lags it" — has been violated
twice, and each time the fix was a hand-built catch-up PR. This skill is
that PR as a ritual.

## Step 1 — establish the gap (live reads only)

- Last drain point: the newest changelog entry with a `version` stamp, or
  the last truthsync PR — whichever is later.
- `git log --oneline <that-point>..origin/main` — every merge since. Include
  work from other sessions; they ship too.

## Step 2 — sweep each ship across the five surfaces

For every substantive merge, ask five questions:

| Surface | The question |
|---|---|
| `lib/changelog.ts` | Does it have an entry? (Build-in-public: features, hardening, and honest boundaries all count) |
| `lib/roadmap.ts` | Did it complete a Now/Next/Later item? Rotate: shipped phrasing or removal, successors promoted, arc comment updated |
| `README.md` | Does a claim, endpoint table row, or guide link now under- or over-state the product? |
| `docs/DOMAIN.md` | Did it add/change a concept the glossary should carry? |
| `docs/TRACEABILITY.md` | Maintenance rule check: enforcing surfaces touched → row still true? New invariant → new ID? |

Also close the loop the other way: backlog entries the ships resolved get
checked off with a "shipped" note.

## Step 3 — verify before writing (the ten-tools rule)

Every count, endpoint, tool name, and behavior claim in a new entry is
verified against the code as it is — grep the source, hit the route table,
count the registrations. A truth surface that's confidently wrong is worse
than a stale one.

## Step 4 — one PR, docs-only

All drains ride together: changelog entries, roadmap rotation, README/DOMAIN
touches, TRACEABILITY rows, backlog checkoffs. Docs-only diff, house voice
(the changelog sells honestly; the roadmap promises one release ahead).
List the ship→surface mapping in the PR body so review is a table scan.

## Rules

- Drift found ≠ license to editorialize: sync the story to the code, don't
  restrategize the roadmap inside a drain (that's a /zoomout decision).
- The public-repo rule applies to every added sentence.
- Cadence: run before every /cut-release (the release notes get written from
  clean surfaces), and whenever /zoomout flags drift.
