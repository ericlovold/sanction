---
name: tailwind
description: Use when the user drops market news and says "pick this up" / "what does this mean for us" - a platform launch, a protocol shift, a competitor move, a policy change. Runs the market-event playbook - verify the event at primary sources, map it onto the engine and roadmap, ship a fenced same-day slice if one exists, and flag the GTM moment. Named for what a well-aimed event is to a small fast product: a tailwind.
---

# tailwind: news speed, product response

A solo founder's edge over incumbents is cycle time: when the market moves,
the product can answer the same day. The Cloudflare pay-per-crawl launch set
the pattern — news at breakfast, a governed-buyer adapter + guide + changelog
entry shipped by lunch. This skill is that pattern, repeatable.

## Step 1 — verify the event before building on it (live-state-truth, applied to the world)

- Primary sources outrank coverage: vendor docs and changelogs over press,
  press over social. Get the actual mechanics — header names, dates,
  defaults, protocol — not the vibe. (Vendor blogs sometimes 403 our fetches;
  their developer-docs subdomains usually don't.)
- Pin the load-bearing facts: what changed, when it takes effect, who's
  affected, what the wire looks like. If a fact can't be verified, it can't
  be in the changelog entry or the guide.

## Step 2 — map it onto Sanction

Three questions, in order:

1. **Which engine primitives apply unchanged?** The best answers need zero
   engine surgery — a crawl quote was "just spend with a hostname for a
   merchant." If the event requires new engine semantics, it's an arc, not
   a tailwind slice.
2. **Which roadmap item does it accelerate?** An event that makes a Later
   item urgent (pay-per-crawl → mandate authority/x402) is the strongest
   signal — the arc was already believed in; the market just voted for it.
3. **Which side of the transaction is ours?** Default to the buyer/governor
   side — "hold the mandate, not the rail." Rails belong to platforms;
   deciding, evidencing, and budgeting belong to Sanction. Say explicitly
   which side the event's vendor owns and why we're not competing there.

## Step 3 — ship the fenced slice (same day or not at all)

The slice is an adapter, a guide, a policy pack, or a pack + console touch —
never hot-path engine surgery on news cadence. It ships with:

- the honest boundary stated (what Sanction governs vs what the vendor's
  rail owns),
- a docs guide with a policy recipe (buyers arrive from the news search),
- a changelog entry that rides the news language while it's hot,
- the follow-on arc captured in the backlog (reconciliation, packs,
  generalization — the slice is the wedge, the arc is the product),
- a roadmap note if the event just started a roadmap item's first slice.

If no fenced slice exists, say so — the deliverable degrades gracefully to
the mapping (step 2) + a backlog arc + the GTM flag. A forced slice on the
wrong event is worse than none.

## Step 4 — flag the GTM moment

News windows close in days. Tell the user what the moment is — the one-line
question the event just invented (e.g. "what did we pay the web last month,
by department?") — and offer to coach a post. Voice-fence applies: structure
and strategy yes, drafting their words never.

## Rules

- No slice before verification; no changelog claim without a checked fact.
- The event does not reorder the roadmap by itself — /zoomout weighs it
  against everything else; tailwind just ships the wedge and captures the arc.
- Speed is the point, but the gate is not waived: tests, docs registration,
  truth surfaces — same bar as any PR.
