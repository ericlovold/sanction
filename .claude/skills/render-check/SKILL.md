---
name: render-check
description: Use BEFORE claiming any UI change works - dashboard pages, marketing pages, theme changes, new components - and whenever the user asks "did you actually look at it?". Seeds a demo org into local Postgres, boots next dev, screenshots the named pages with the preinstalled Chromium, and attaches the evidence. A visual claim without a screenshot is the repo's most expensive known failure mode; this skill makes the proof one word.
---

# render-check: no pixels, no claim

This repo learned the hard way that "tsc passes and the classes look right"
is not the same as "the page renders correctly." Design fixes were claimed
and re-claimed until a human said *still broken*. The rule since: a visual
change is verified by rendering it, or it is not verified.

## The ritual

1. **Postgres** (containers are reclaimed — re-check every time):
   ```bash
   sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl status -D /var/lib/postgresql/16/main
   sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl start -D /var/lib/postgresql/16/main \
     -o "-c config_file=/etc/postgresql/16/main/postgresql.conf"
   ```
2. **Seed** what the pages need to show. For org-level surfaces, a two-level
   org (root + one child pool, agents in both, a pending escalation, a few
   decisions and a token log) exercises subtree scope, pool attribution, and
   the approvals inbox at once. Seed via `psql` inserts — the generated
   Prisma client is TS-only and won't run under plain node. Column gotchas
   that have bitten: `Agent.apiKeyPrefix` is NOT NULL; `PendingApproval`
   needs `updatedAt`.
3. **Dev server** on a spare port, demo view (no login needed):
   ```bash
   DATABASE_URL=... SANCTION_SIGNING_SECRET=... SANCTION_CREDENTIAL_ENCRYPTION_KEY=... \
   SANCTION_WALLET_ID=<seeded root id> npx next dev -p 3112
   ```
   If Next says another dev server owns the dir, kill the PID it names.
4. **Assert fast, then look**: `curl | grep` for the load-bearing strings
   first (cheap, catches 500s), THEN screenshot — grep proves presence,
   pixels prove layout:
   ```bash
   node --input-type=module -e '
   import { chromium } from "playwright-core"
   const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" })
   const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
   await p.goto("http://localhost:3112/<page>", { waitUntil: "networkidle" })
   await p.screenshot({ path: "<scratchpad>/<page>.png", fullPage: true })
   await b.close()'
   ```
   (Run from the repo root — `playwright-core` resolves from cwd. The
   chromium path is versioned; `ls /opt/pw-browsers/` if it moved.)
5. **Attach the screenshots** to the user AND read them yourself — a
   screenshot you didn't look at proves nothing.
6. **Clean up, always**:
   - kill the dev server
   - `rm -rf .next` — stale dev artifacts have broken `tsc` on later gates
     in this exact repo; leaving them is a booby trap for the next command.

## What to render

- The pages the diff touched, in the state the diff targets (seeded data
  that exercises the new branch, not an empty wallet).
- Theme changes: BOTH light and dark. The console defaults light; docs/dev
  surfaces are scoped dark — a fix in one has broken the other before.
- Mobile-shaped bugs: a second pass at `viewport: { width: 390, height: 844 }`.

## Rules

- No screenshot, no "fixed." Say "changed, not yet rendered" if you must
  stop early — never the stronger claim.
- Grep-assertions alone don't close a *visual* issue; they only catch
  crashes. The screenshot is the deliverable.
- Seeded ids are throwaway; never real wallet ids. The seed lives and dies
  in the local container.
