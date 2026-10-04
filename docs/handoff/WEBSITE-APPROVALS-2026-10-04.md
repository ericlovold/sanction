# Website handoff: one-off approvals

Date: 2026-10-04. Owner: website contributor (Perplexity Computer).
Product behavior and authorization contracts remain with Codex. This brief scopes
one website PR; it is not permission to deploy, publish posts, or change authority.

## Goal and agreed direction

Lead with **one-off human approvals for AI agent actions, across the tools people
already use**. Collaboration across platforms and providers is the larger product
direction. Preserve the existing brand, components, accessibility, and deeper
budget, vault, gateway, and broker documentation.

Build the first website slice, not the full GTM document's multi-week program.
Success is a visitor understanding what Sanction does, choosing an appropriate
connection path, and finding a synthetic approval example that executes nothing.

## Starting point and verification

Start from current `origin/main` in a clean branch, `codex/website-one-off-approvals`.
Do not reuse a stale working checkout or overwrite another contributor's changes.

At handoff, `origin/main` was `2d16a32516715b59596d35fed28f6bd0c45dedf2`
(#350: agent creation during MCP connection). The clean handoff checkout had no
content diff from that main. `gh pr list --state open` returned no PRs before this
handoff. Recheck both before starting.

Verified this session:

- `curl`/HTTP reads: homepage and `/.well-known/mcp.json`,
  `/.well-known/agent-card.json`, `/.well-known/wallet-card.json` returned 200;
  `/llms.txt` and `/robots.txt` returned 404. A missing robots file does not prove
  crawling is blocked. A published Agent Card does not prove A2A interoperability.
- `npm view sanction-mcp version`: 0.10.0.
- `gh release list --limit 2`: latest GitHub release v0.9.0. Root app version is
  also 0.9.0; these are separate version surfaces. Do not bump or release here.
- `git diff --stat origin/main` in the clean handoff checkout: empty.

`npm run check` passed in the clean baseline: typecheck, lint, 152 test files
and 1,817 tests passed; 10 files / 56 tests skipped (including DB-gated tests).
This is not live-host evidence. Run the gate again on your final website diff.

## File ownership

Website contributor may edit:

- `app/page.tsx`: hero, concise three-step loop, connection CTA, boundaries,
  links into existing deeper content, and existing homepage JSON-LD.
- `app/layout.tsx`: metadata only; keep font, theme, auth, analytics, and shell behavior.
- `app/opengraph-image.*` / `app/twitter-image.*`: existing social-card copy if
  needed to match the new message; inspect actual files before editing.
- `public/llms.txt` and `public/robots.txt`: factual discovery text and explicit
  crawler guidance. Keep public docs/OpenAPI discoverable; robots is not access control.
- `public/.well-known/mcp.json` and `public/.well-known/agent-card.json`:
  additive, backward-compatible metadata alignment. Preserve existing fields and
  capabilities; do not imply a new wire protocol or overwrite the full-wallet profile.
- `docs/CONNECT.md`: one-off example and explanation of the two profiles.

Keep this first PR focused. Navigation restructuring, `/compatibility` migration,
new connector routes, RSS/email signup, telemetry, and an onboarding progress
tracker are later slices. Existing routes must keep working.

Codex owns `app/api/**`, `app/mcp/**`, `app/connect/**`, `app/start/**`,
`lib/mcp*`, `lib/grants.ts`, decision/policy/approval code, schemas, SDKs, tests,
packages, release workflows, and roadmap/changelog evidence. Do not edit those in
the website PR. Flag any needed changes with the exact file and reason.

## Copy requirements and boundaries

Suggested hero: **Let your agent ask before it acts.**
Explain: exact request → authorized human decision → one-use grant redemption.
Show dashboard review as the baseline; Slack is an optional configured surface,
not a promise that arbitrary people can approve by email or Slack handle.

The important distinctions:

- `/mcp/approvals`: eight tools, OAuth connection for hosts; no credential
  retrieval or execution-token issuance. API-key compatibility also exists.
- `/mcp` and stdio: ten tools, agent API key; includes scoped execution tokens
  and credential retrieval. Do not merge the profiles or remove either.
- Cooperative connections require the host to consult Sanction and honor its
  answer. Connecting it does not intercept unrelated tools. Broker enforcement
  applies only to routed upstream calls.
- Grants bind to wallet, agent, tool, server, and arguments. A different host is
  not automatically a different authorized executor. Do not advertise transferable grants.
- A decision record proves the recorded authorization decision, not that an
  external action executed or obeyed it. `sanction_log_outcome` records business
  outcomes, not execution receipts. Unknown execution is not evidence of no effect.
- Sanction has an encrypted credential vault. The full profile can return a
  scoped credential; never say Sanction does not hold keys or never reveals them.
- A chat-level yes cannot override organizational policy or a hard denial.
- Free for individuals, no card; do not invent pricing tiers or consulting offers.

Do not claim native approvals only approve tool names or cannot bind arguments.
Describe Sanction's own behavior without unsupported competitor comparisons.
Do not say it starts with zero policy: explicit human approval needs no policy
edit, but existing hard denials still apply.

Connector claims need separate dated evidence for connection, lifecycle tests,
submission, and public listing. Unknown stays unverified. Community listing is
not Verified status. `docs/MARKETPLACE-SUBMISSION.md` contains older observations;
verify before copying. Do not invent users, testimonials, performance numbers,
no-duplicate guarantees, or a completed cross-company approval flow.

## Working synthetic example

Use the current skill at `packages/sanction-approvals/skills/request-approval/`.
Request approval for `sanction.demo.approval` with
`{"execute":false,"message":"Website approval demo"}` and
`require_approval: true`; explain that this tests approval only.

On `wait`, show the request ID and link, then pause. After user resumption, check
once with `sanction_check_authorization`. On `retry_with_grant`, call
`sanction_authorize_tool` once with identical input plus the grant. Report the
result, but execute nothing in this example. Stop on denial, unusable grant, or
uncertainty; no automatic polling, altered retries, or new approval requests.

Use a labeled static example in the website PR. Do not mutate production or
create review notifications to demonstrate copy. Link existing sanitized test
evidence; a new live recording is a separate coordinated step.

## Build and acceptance

Read `AGENTS.md`, `docs/DOMAIN.md`, and relevant Next.js guides in
`node_modules/next/dist/docs/` before editing. Next.js conventions here may differ
from prior versions. Run `npm ci` if needed, then `npx prisma generate`,
`npm run check`, and `npm run dev`. Use isolated local test data if a page needs
it. Never run migrations against inherited production credentials.

Before opening the PR:

1. Show desktop and mobile screenshots of every changed visible surface. Confirm
   keyboard navigation, contrast, CTA destinations, and no horizontal overflow.
2. Check rendered title, description, OG/Twitter text, and the existing JSON-LD;
   avoid inserting duplicate SoftwareApplication markup.
3. Check all changed links and discovery JSON/text. `/docs/connect` is intended
   as a real guide, not a placeholder. MCP endpoints are protocol endpoints, not
   browser onboarding pages.
4. Preserve old manifest fields and tool names; validate any additive metadata.
5. Run `npm run check`; report actual counts and failures. Do not infer host
   conformance from unit tests or a static screenshot.
6. Open one PR against main with screenshots, checks, remaining uncertainties,
   and a short file list. Do not merge, deploy, publish registry metadata, cut a
   release, or post launch content as part of this handoff.

## Parallel product work and follow-on slices

Codex's immediate slice makes failed tool-grant guidance agree with terminal
stop behavior. It does not change grant decisions, identity, policy, or schemas.
Then: finish expiry/revocation/cross-agent host evidence; prove a Slack review
flow with verified reviewer authority; expand host tests and integration examples.

GTM priorities: a credible demo, independent first-use completion, and a second
real request. Count synthetic tests separately. Keep broader launch campaigns,
new approver roles, delegation, standing allowances, and execution reporting out
of this website PR.

## Handoff ledger

- VERIFIED: main hash, clean content baseline, open-PR snapshot, live HTTP statuses,
  npm version, and GitHub release snapshot were checked this session.
- LANDMINE: top-level checkout may be an older dirty branch; start from current main.
- LANDMINE: preview builds can inherit production database configuration; do not migrate.
- DRIFT: marketplace notes and public positioning lag observed product progress;
  verify claims rather than treating those documents as current portal state.
- OWNER DECISION: brand redesign, pricing, legal terms, reviewer authority, and
  publication remain outside this handoff.
