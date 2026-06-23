# EPIC: Radically simplify onboarding UX

**Status:** all slices (S1–S5) shipped 2026-06-23
**Opened:** 2026-06-23
**Owner:** Eric

## Problem

The post-create-agent screen (and the /start success screen) is a wall. After creating one agent the user sees, stacked:

1. The agent key + copy
2. A `curl` "try it" block
3. "Route a provider" — 4 rows (Anthropic / OpenAI / Gemini / Header)
4. An OpenAI SDK example

The key is printed **three times** on one screen. That's fine for a backend engineer skimming for the endpoint. It is overwhelming for the people we're actually courting: **vibe coders and junior devs** evaluating tools. They don't want options — they want the one thing that works, now.

## Who this is for

Inexperienced / non-traditional devs (Cursor/Claude-Code users, students, indie hackers). They copy-paste, they don't read reference docs, and they bounce the moment a screen looks like work.

## Goal

Create agent → **one** visible next step → a successful first call. Everything else is hidden until asked for.

**Success metric:** time-to-first-successful-call drops; activation rate (created → made a real call) goes up. Instrument it (we have Vercel Analytics; add a client event on first 200 from the gateway/authorize).

## Principles

1. **One primary action at a time.** Progressive disclosure, not a stack of blocks.
2. **Pick one happy path by default.** Most of this audience uses an SDK, not curl. Lead with a single drop-in snippet; demote curl to an "Advanced / raw HTTP" toggle.
3. **Show the key once.** Reference it everywhere else, don't reprint it.
4. **Snippet matches their stack.** A small picker (Node / Python · OpenAI / Anthropic / Gemini) yields exactly one copy-paste block with their key already in it. No four rows to mentally diff.
5. **No jargon up front.** "base URL," "header," "x-sanction-key" can live inside the snippet — they don't need a paragraph explaining them.

## Proposed slices (ship independently)

- **S1 — Collapse the reveal.** ✅ DONE. Default view = key (once) + an in-browser **TestDecision** button as the single primary action. Curl, SDK wiring, and MCP config moved behind native `<details>` disclosures (`components/disclosure.tsx`). Even better than the planned static snippet: the primary action *runs a real /authorize decision in the browser* — no curl, no provider key, no terminal — and persists to the log.
- **S2 — Stack picker.** ✅ DONE. `components/connect-app.tsx` — Node/Python × OpenAI/Anthropic/Gemini toggle rewrites one drop-in snippet in place. Killed the 4-row grid. Fixed real breakage: OpenAI base URL needs `/v1`; all snippets now include the provider key (the gateway forwards it, doesn't vault it yet).
- **S3 — Live "first call" confirmation.** ✅ DONE. `components/gateway-watch.tsx` polls `GET /api/v1/activity` (new route) with the agent key and flips to "✓ first call received — model · tokens · $cost" when the gateway meters a real call. Bounded poll (5s, ~5min cap, pauses on hidden tab).
- **S4 — Apply the same pattern to /start.** ✅ DONE. Signup success screen now uses TestDecision + the same three disclosures (Connect / raw HTTP / MCP). Dropped the verbose "Next" list.
- **S5 — Instrumentation.** ✅ DONE. Vercel Analytics funnel events: `agent_created` / `wallet_created` → `test_decision` {amount, status} → `snippet_copied` {provider, lang} → `first_gateway_call` {model}. View in the Vercel Analytics dashboard (Events tab).

## Out of scope (for now)

Per-agent budgets, agent edit/delete, vault-injected provider keys (see `docs/NEXT-TIER.md`). This epic is purely about getting a new user to their first successful call with the least friction.

## Recommended first move

S1. It's the highest-leverage, lowest-effort slice — it's mostly hiding what already exists behind a disclosure and choosing one default snippet. The components are `components/agent-creator.tsx`, `components/gateway-providers.tsx`, and `components/create-wallet.tsx`.
