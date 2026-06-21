# Sanction — Session Handoff

**Date:** 2026-06-21
**From:** Claude Code (web session)
**To:** Claude Code (desktop)
**Repo:** `github.com/ericlovold/sanction` · branch `feat/landing-pricing-page`

---

## TL;DR

The GTM/UX policy fixes have been **reconciled into the SEC/FUND `feat` branch, pushed, and deployed to production**. Everything is green. **One action remains: publish the `sanction-mcp` npm package** — it's fully prepped but needs Eric's npm auth.

---

## Current state (all verified)

| Thing | State |
|-------|-------|
| Branch `feat/landing-pricing-page` | `a9699d7` — local == origin, working tree clean |
| Production (`onesanction.com`) | Aliased to `a9699d7` — escalation fixes **live** |
| Typecheck (`npx tsc --noEmit`) | Clean |
| Tests (`npm test`) | 23/23 pass (crypto 12, decisions 6, approvals 5) |
| MCP bundle (`packages/sanction-mcp/mcp-server.js`) | Rebuilt from merged source — points at `onesanction.com`, has `execution_jwt`, zero `sanction.ai` stragglers |
| npm package `sanction-mcp` | **Not yet published** — name unclaimed (registry 404), `0.1.0` ready |

---

## What changed this session

Reconciled two lines of work that had diverged:

- **`feat` branch (`8e82efa`, already in prod before this session):** SEC-1 per-wallet HKDF keys, SEC-5 JWT `aud` binding, FUND-1 `simulate` mode, SEC-3 tenant middleware, plus an execution-budget hard cap and `escalation.created`/`budget.exhausted` webhooks.
- **My GTM/UX work:** made escalation actually reachable on default policy (GTM-1), enforced the advertised `allowedCategories` allow-list (GTM-2), and added an escalation-timeout fallback so agents never deadlock waiting on a human (UX-2).

### Commits added on top of `8e82efa`
```
a9699d7 chore: regenerate prisma client for merged policy schema
88d98bb merge: reconcile GTM/UX policy fixes with SEC/FUND feat branch
f7ef6a0 Add escalation timeout fallback so agents never deadlock (UX-2)
fcb6258 Fix spend ladder: make escalation reachable + enforce advertised policy knobs
```

### The one merge conflict — `app/api/v1/authorize/route.ts`
Auto-merge couldn't resolve it because the two features **interact**. Resolution decisions (read these before touching the route):

1. **Exec-budget deny gate runs *before* the auto-approve floor.** Otherwise a sub-floor charge could bypass an execution's hard budget cap.
2. **Single approval path debits the execution budget on *every* approval, including sub-floor ones.** My floor originally did an early `return approved` that would have skipped feat's `spentUsd` debit — repeated small charges would never decrement the exec budget.
3. **Allow-list deny gate now honors `simulate` mode.** It was written before FUND-1 existed and would have called `persist()` (a real DB write) during a dry-run.
4. **The `simulate` path mirrors floor-over-escalation precedence** so a dry-run decision matches a live one (FUND-1's whole promise).

### Schema invariant to remember
Policy defaults now encode the spend ladder (in cents):
```
amount <= autoApproveUnderUsd (1000 = $10)         -> approved (silent)
autoApproveUnderUsd < amount <= escalateOverUsd     -> approved
escalateOverUsd (2500 = $25) < amount <= perTxnMax  -> escalated (human)
```
**For escalation to be reachable, `escalateOverUsd` must be < `perTransactionMaxUsd`.** That's the GTM-1 fix — don't reintroduce a config where they cross.

New migrations: `20260620180000_policy_escalation_defaults`, `20260620190000_escalation_timeout`.

---

## ⏭️ Outstanding: publish `sanction-mcp` to npm

The package is prepped and verified (`npm pack --dry-run` = clean 5-file / 233 kB tarball, valid `server.json`, correct shebang). It just needs Eric's npm credentials — there is no npm auth in the web sandbox.

**Publish from a machine that's `npm login`'d:**
```bash
git pull origin feat/landing-pricing-page
cd packages/sanction-mcp
npm publish          # unscoped public package — no --access flag needed
```

**Verify after publish:**
```bash
npm view sanction-mcp
npx -y sanction-mcp   # should start the stdio MCP server
```

> ⚠️ `0.1.0` is a one-shot version number. The committed bundle is already the
> reconciled one — if you rebuild first (`npm run build:mcp`), confirm it still
> shows `onesanction.com` and `execution_jwt` before publishing.

### Optional follow-up — MCP registry
`packages/sanction-mcp/server.json` is already a valid MCP-registry manifest (`io.github.ericlovold/sanction`). Once the npm package is live, `mcp-publisher` can list it in the MCP registry too.

---

## Notes / caveats

- **Prod smoke test wasn't possible from the web sandbox** — `onesanction.com` isn't in its egress allowlist. Recommend one manual check: `POST /api/v1/authorize` with `amount_usd` between `escalateOverUsd` and `perTransactionMaxUsd` should now return `status: "escalated"` (not auto-approve).
- **No automated test covers `authorize/route.ts` directly** (the existing suite needs no DB; the route uses Postgres advisory locks). The merge logic above is currently only typecheck-verified. Consider adding an integration test against a test DB for the floor / escalate / exec-budget interaction.
- All production wallet IDs / API keys remain out of the repo (Vercel env + secret store), per `AGENTS.md`.

---

## Key files
```
app/api/v1/authorize/route.ts   — policy engine (the merged conflict file)
lib/policy.ts                   — escalation-timeout helpers
lib/approvals.ts                — approval/escalation settling
app/api/v1/authorize/[id]/route.ts — escalation resolve + timeout fallback
prisma/schema.prisma            — Policy model w/ spend-ladder defaults
packages/sanction-mcp/          — npm package (mcp-server.js bundle, server.json)
mcp-server.ts                   — MCP server source (rebuild via `npm run build:mcp`)
```
