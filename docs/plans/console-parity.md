# Console parity — click what you currently curl

> Shared build spec for the console-parity arc. Reviewed by both AI collaborators
> (plan + cross-review). Build order = PR order below. Closes the backlog item
> "Console/API parity."

## Why
Sanction's newest capabilities — policy simulation, packs, capability rules,
evidence replay, period reporting + audit CSV — are **API-only**; an operator
has to `curl` them. This arc surfaces them in the operator console. Enabling
fact: nearly every capability already has a pure `lib/` function the dashboard
calls directly (as it already does with `applyPolicyUpdate`), so this is
UI + action-plumbing over proven backend — **no schema changes**, only two small
lib extractions.

## Patterns (reuse, don't reinvent)
- Page = async server component, `dynamic="force-dynamic"`, `getViewWallet()`
  (`lib/session.ts`) → `<NoWallet/>` if null → read `db` directly.
  `view.isSession` drives `editable`.
- Mutation = co-located `actions.ts` (`"use server"`) → `getSessionWallet()` gate
  → parse FormData → call a `lib/` fn → `revalidatePath`. Client uses
  `useActionState`, returns `{ok, message}`.
- Nav = hardcoded `items` array in `components/dashboard-sidebar.tsx`.
- **Auth mismatch (load-bearing):** the console authenticates by cookie session;
  the `/api/v1/*` audit/summary routes authenticate by `x-mgmt-key`/agent-key
  headers the browser never sends. Console surfaces call `lib/` directly or use a
  **cookie-authed dashboard route handler** — never the header-authed API routes.

## PR1 — Full policy editor on `/dashboard/policy`
Closes CAP-1's deferred dashboard rule editor + exposes 7 uneditable fields. No
lib/schema change (`policyInputSchema`/`policyToDollars`/`applyPolicyUpdate`
already cover all 15 fields). New `page.tsx` + `actions.ts` (move + extend
`updatePolicyAction`); extend `components/policy-editor.tsx` to 15 fields incl. a
capability-rule repeater (client array → one hidden JSON input; `capabilityRules`
zod is the sole validator); tool lists are comma-inputs but **not lowercased**
(case-sensitive/namespaced). Spend page swaps the inline editor for a link. New
`Policy` nav item. `revalidatePath` hits **policy + spend + dashboard**. Fix the
`policy-editor.tsx` import path (was `@/app/dashboard/spend/actions`).
Tests: `tests/policy-actions.test.ts` (mirror `pool-actions.test.ts`).

## PR2 — Pack picker + simulation preview on `/dashboard/policy`
`components/pack-picker.tsx` (POLICY_PACKS cards by maturity; Preview + **confirm-
gated** Apply), `components/simulation-report.tsx` (renders the `runSimulation`
envelope honestly: `state`, `totals.was/would`, `approved_spend_usd`, `counts`,
`changes[]`, `ignored_fields`, `truncated`, `note`, `note_truncated`). Actions:
`previewPackAction`/`simulateDraftAction` (**no write**), `applyPackAction`
(`applyPolicyUpdate` + revalidate). `simulateDraftAction` posts the full 15-field
form. Tool/capability fields land in `ignored_fields` today — show that.

## PR3 — Audit & reporting page + CSV on `/dashboard/audit`
**Extract, don't replicate** — the one real backend task, with typed lib return
objects: `lib/reportingSummary.ts` `buildPeriodSummary(walletId,{start,end,groupByAgent})`
(lifts the 8 queries incl. two `date_trunc` `$queryRaw` day-buckets) and
`lib/auditFeed.ts` `buildAuditFeed(walletId,{type,limit,before})`. Both routes
delegate (existing route tests must stay green). New `app/dashboard/audit/page.tsx`
(KPIs + per-agent rollup + feed table, `?from=&to=` range, default 7d; feed v1 =
fixed `limit=50`, cursor pagination is a follow-up) and **cookie-authed**
`app/dashboard/audit/export/route.ts` (`getSessionWallet` → `buildAuditFeed` →
`toCsv`, `<a download>`; session-only so the public demo view can never export). New `Audit` nav item. Tests:
`tests/reportingSummary.test.ts` + a `*.db.test.ts` case for the `date_trunc` SQL.

## PR4 — Evidence replay view `/dashboard/audit/[id]`
`app/dashboard/audit/[id]/page.tsx` — enforce `row.agent.walletId === view.id`
(404 if agent row missing), load the in-force `PolicyRevision`, `isDecisionEvidence`
guard, `replayEvidence`, prominent `matches` banner, pre-EVID-1 null state. Link
rows from the audit feed **and** the approvals page.

## Guardrails
- **No schema changes.** Only new lib code = the two PR3 extractions.
- **Provision resource lists** (`allowedResources`/…) are a 16th policy field **not
  in `policyInputSchema`** — stay API/DB-only until a follow-up. The full editor
  governs 15 fields, **not** `/authorize/provision` resource lists in v1. Say so.
- Preview/simulate actions **never persist**.
- Every console data path is cookie-authed (`getViewWallet`/`getSessionWallet`),
  incl. the CSV export route.
- **Demo-mode QA (every PR):** in demo view (`SANCTION_WALLET_ID`, no login),
  Policy/Audit render read-only; Save/Apply/CSV return auth errors or disabled
  UI, never silent no-ops.

## Nav order (final)
Approvals → Policy → Spend → Audit → Agents → Overview → Pools.
