# Sanction - Fable Handoff

Date: 2026-07-01

## Current steer

Sanction is the independent authorization boundary for autonomous systems.

Agent platforms create action. Sanction authorizes action. The product should stay cross-runtime, rail-neutral, and human-approval native. Do not drift into building an agent builder, workflow orchestrator, or payment rail before a paying design partner forces it.

## Repo state

| Area | State |
|---|---|
| Production base | `main` at `58f7cdb` after PRs #37-#40. |
| Current branch | `feat/mia-local`. Contains the MIA public-hold commit `59145bb`, the Fable handoff commit `dca2c23`, and the public Ethical AI hold. |
| Public ethics/MIA status | Not published. `/ethical-ai` and `/mia-local` are removed; public app files contain no Ethical AI or Moral Intention Analyst links/copy. |
| Dev server | Local preview was restarted on `http://localhost:3000`; `/ethical-ai` and `/mia-local` should both 404. |
| Side branch to inspect | `feat/pool-allocation-controls` contains actionable pool allocation controls and tests. It is not merged into this branch. |

## What is live conceptually

- Gateway metering across providers.
- Wallets, nested account tree, and read-only subtree rollups.
- Opt-in subtree daily cap enforcement.
- Generic-ish approval and grant model.
- Spend grant consumption after human approval.
- Provision authorization API and UI rendering in Approvals/Grants.
- Public docs for Quickstart, Vercel AI SDK, LangChain, CrewAI, multi-tenant.
- Ethical AI and Moral Intention Analyst are internal planning only; neither is public.

## Product boundary decisions

| Decision | Rationale |
|---|---|
| Sanction stays control-plane first, not fund custody. | Lower regulatory surface; current code authorizes/logs spend but does not move money. Revisit only for a paid design partner. |
| Approvals produce ephemeral Grants. | Human approval should not mutate policy. A grant is the audit-grade, one-use authorization artifact. |
| Ethical AI and Moral Intention Analyst are held. | The channel may become valuable, but it should not be public until AC Ping attribution, packaging, hardware, services, and licensing are ready. |
| Agent platforms are distribution, not competition. | Omnigent-style builders increase the need for an external authorization boundary. |

## Near roadmap

| Priority | Work | Notes |
|---|---|---|
| P0 | Security gate | `SEC-1` KMS envelope encryption, `SEC-3` RLS, `SEC-5` JWT `aud`/single-use hardening, `SEC-6` key scoping. |
| P0 | Fund/custody ADR | Ratify control-plane/no-custody as the default position unless a paid rail need appears. |
| P1 | Tool and credential grant consumption | Spend grant consumption exists. Tool and credential approvals still need the same retry-with-grant loop. |
| P1 | Notification adapters | Email first, then Slack/webhook. This is how Sanction becomes workflow governance, not a passive inbox. |
| P1 | Agent-platform starter kit | One universal recipe: before spend/tool/credential/provision, call Sanction; if escalated, wait for grant; if denied, stop. |
| P1 | Runtime/source attribution | Add runtime/source metadata (`cursor`, `claude-code`, `codex`, `omnigent`, `bedrock`, `custom`) to agents/requests/audit. |
| P1 | Provider-key vault injection | MMHC/David signal: agents should hold `pxy_`/execution capability, not provider keys. |
| P2 | Audit evidence | Hash-chained audit log + export unlocks enterprise proof. |
| P2 | Pool allocation controls | Pull from `feat/pool-allocation-controls` after reconciling docs. It applies parent cap allocation strategies to child pools. |
| P2 | Policy-as-code / CLI / SDK wrappers | Distribution wedge for coding agents and framework adoption. |

## Branch instructions

1. Start from the current branch if the goal is to preserve the Ethical AI/MIA hold and roadmap updates.
2. If pulling pool allocation work, cherry-pick code/test files from `feat/pool-allocation-controls`; do not blindly take its `docs/ROADMAP.md` because this branch now contains the newer ethics/MIA hold section.
3. Keep `docs/MIA-LOCAL.md` internal. It is not registered in `lib/docs.ts`.
4. Before publishing anything public about Ethical AI or Moral Intention Analyst, get explicit founder approval on pricing/licensing and Dr. Ping positioning.

## Verification already run on the MIA hold

- `npm run lint`
- `npx tsc --noEmit --pretty false --incremental false`
- `npm run build`
- Route check: `/ethical-ai` returns the 404 page.
- Route check: `/mia-local` returns the 404 page.

## Watch-outs

- Disk was nearly full during build verification. `.next` had to be cleared once to regenerate clean route types.
- Better Auth emits local build warnings because `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET` are not set for local verification. This is pre-existing local-env noise.
- Some local branches are stale or behind. Treat `main`, `feat/mia-local`, and `feat/pool-allocation-controls` as the relevant ones for this handoff.
