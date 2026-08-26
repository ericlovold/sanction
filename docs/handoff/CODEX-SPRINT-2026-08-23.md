# Cold-start export — Codex sprint, 2026-08-23

> Produced by `/fresh-eyes`. Every claim below was verified against the live
> system in the run that wrote this file; the verifying command is named
> inline. Nothing here is from memory or from another document.
>
> **Re-verify before acting.** This file is accurate as of
> 2026-08-23 21:15 UTC and starts going stale immediately.

## 0. Sprint fence

**In scope for this sprint**

- Whatever Eric names when the sprint opens.
- The unowned items in §5 — each is small, self-contained, and blocked only
  on someone picking it up.

**Explicitly out of scope** (do not "fix" these — they are decisions already
made, or they belong to another pass)

| Thing | Why it stays |
|---|---|
| `/about` still reads as a services firm | Deliberate. The 2026-08-10 reposition put the firm on `/about` and the product on `/platform`. Whether repo docs follow is **Eric's call** — `AGENTS.md` says do not fix unprompted. |
| README/AGENTS.md describing the product identity | Same decision. Queued as a `/truthsync` pass, not a drive-by. |
| The five unmerged feature branches in §4 | Real unmerged work. Read before touching; none is abandoned by decision. |
| `.npmrc` `legacy-peer-deps=true` | Intentional. |
| `lib/generated/prisma` | Generated, gitignored. Never hand-edit; run `npx prisma generate`. |

## 1. Ground state (verified)

| Fact | Value | Verified by |
|---|---|---|
| Default branch | `main` @ `5dc4c9c` (PR #259) | `git fetch origin && git log origin/main` |
| Work branch | `claude/tokenjam-competitor-analysis-8rc4cb`, content identical to `main` | `git diff origin/main..HEAD` → empty |
| Open PRs | **none** | GitHub API, `state=open` |
| Gate | tsc 0 · eslint 0 · **1189 passing**, 20 skipped (DB tests gated off) | `npm run check`, this run |
| Release | `v0.8.0` — root `package.json`, `packages/sanction-mcp`, `sdk` all `0.8.0` | `node -p`, `git tag` |
| npm | `sanction-mcp@0.8.0`, `sanction-sdk@0.8.0` — both match the repo | registry `/latest` |
| Production | `getsanction.com` — `/`, `/platform`, `/blog`, `/api/openapi.json` all 200 | `curl -o /dev/null -w '%{http_code}'` |

## 2. 🔴 Production is one merge behind main

**The single most important line in this document.**

| | |
|---|---|
| Last **production** deploy | 2026-08-22T22:58:42Z — `main@4eb85d4` = **PR #258** |
| PR #259 merged to main | 2026-08-23T19:23:36Z |
| Deployments since | **zero**, of any kind |

PR #259 merged and **never produced a build.** Main has auto-deployed to
production three times in the preceding day (#255, #257, #258), so this is an
anomaly, not the configured behavior.

Confirmed from the live site, not just the API:

```
GET https://getsanction.com/opengraph-image.png   → 404   (should be 200, 1200x630)
GET https://getsanction.com/moral-intention       → 200   (should be 301 → moralintention.com)
```

So production is currently missing, from #259: the social/OG cards, the
`/moral-intention` redirect, the MIA and A.C. Ping content removal, and the
nav lockup descriptor.

**Fix:** redeploy `main@5dc4c9c` to production from the Vercel dashboard
(project `sanction`, team `lovold`). Then re-run the two curls above — the
first must be 200, the second 301. This is a **human action**; do not assume
it has happened.

**Why this matters beyond today:** `AGENTS.md` already carries a dated note
that *production must deploy from `main`*, written after a 2026-08-22 incident
where a branch was promoted straight to production. This is the same
invariant failing from the other direction — main moved and production did
not follow. Check it explicitly at the end of every arc.

## 3. What just landed (the last arc, in a stranger's terms)

Sanction decides whether an AI agent may spend money, call a tool, or use a
credential — *before* it happens. The last arc pushed that onto stablecoin
rails and rebuilt the public story around it.

- **BROKER-1** — `/mcp/broker/<upstream>` authorizes every MCP `tools/call`
  before forwarding it. Upstream credentials are vaulted, so the agent never
  holds them.
- **STABLE-0** — `/v1/authorize` accepts optional `settlement {rail, asset,
  network}` (closed vocabulary, inert to the decision) so the audit trail
  records how a spend settles.
- **STABLE-1** — the x402 spend gate. `POST /v1/authorize/quote` prices an
  HTTP 402 payment challenge and runs the normal policy ladder *before the
  wallet signs*. On refusal, the broker **withholds the challenge** — the
  refusal type structurally cannot carry `payTo` or `maxAmountRequired`.
- **MONO-0** — per-wallet, per-UTC-month decision counter. The decision is
  the intended billable unit for the Pro tier.
- **GTM** — `getsanction.com` is the authorization product only; MIA and
  A.C. Ping moved to `moralintention.com` (separate repo). Nav lockup carries
  the "Agent authorization" descriptor; social cards added (see §2 — not live yet).

Design record: `docs/plans/stablecoin-rails.md`,
`docs/plans/monetization-and-distribution.md`. Behavior→test map:
`docs/TRACEABILITY.md`. Vocabulary: **read `docs/DOMAIN.md` before naming
anything.**

## 4. Branches

Seven remote branches are fully absorbed into `main` and safe to delete.
Verified by locating each PR's squash commit on `main`, and — for
`fix/hero-noncustodial`, which has no `#256` commit because that PR was
stranded and re-landed via #257 — by confirming its content is present.

```bash
git push origin --delete \
  claude/homepage-coin-illustration \
  claude/truthsync-v0.8.0-drain \
  claude/update-logo-wordmark \
  codex/workflow-marketing-on-current-design \
  copy/mia-plain-language \
  feat/python-litellm \
  fix/hero-noncustodial
```

Recorded tips, so any deletion is reversible:

| Branch | Tip | Landed via |
|---|---|---|
| `claude/homepage-coin-illustration` | `56bb522` | #254 `bfcefc7` |
| `claude/truthsync-v0.8.0-drain` | `1c07cb1` | #245 `82348ec` |
| `claude/update-logo-wordmark` | `c215c70` | #253 `b222979` |
| `codex/workflow-marketing-on-current-design` | `2aad868` | #255 `99b0719` |
| `copy/mia-plain-language` | `97524cd` | #235 `12553eb` |
| `feat/python-litellm` | `79fb4e9` | #237 `41ca66c` |
| `fix/hero-noncustodial` | `8ce2f67` | #257 (content check) |

**Keep — real unmerged work, no PR ever opened.** Read before touching:

| Branch | Carries |
|---|---|
| `chore/split-consulting-to-ericlovold` | `/consulting` pages, `docs/GOVERNED-WORKFLOWS.md`, dashboard edits |
| `claude/install-center` | `/install` page + the `/dev/mcp-tester` harness |
| `claude/mcp-test-ui-spec` | the MCP tester alone (subset of the above) |
| `claude/docker-agentic-governance-99btls` | `docs/COMPATIBILITY.md` Docker AI-governance mapping |
| `claude/new-session-bd58mb` | a "governance layers compose" section for `/compatibility` |

`main-backup-pre-jul4` is a deliberate safety snapshot. Leave it.

## 5. Open loops, ranked

1. **Redeploy production** (§2). Everything else is cosmetic next to a
   production that is a merge behind.
2. **DIST-0 — MCP registry listings.** Still the highest-leverage unstarted
   item: one `server.json`, five listings (official MCP registry, Glama,
   PulseMCP, Smithery, mcp.so). Roughly a day. Never started.
3. **CLARITY Act reaction pieces.** Senate cloture vote ~2026-09-15. Both
   pieces should be written *before* it. The standing argument: §604's
   non-controlling test ≡ Sanction's veto-only shape.
4. **STABLE-2** — wallet-provider co-signer over the existing AuthZEN PDP.
   Veto-only, by design and by law (see §6).
5. **STABLE-1 follow-ups** — an operator-declared priceable-asset registry
   (beats hardcoding token addresses); settlement receipts reconciled back to
   decisions; the quote default category `api`, which denies under allow-list
   policies until listed or overridden.
6. **Counsel memo before any pricing launch** — two questions: does a
   decision-linked fee change money-transmission analysis, and does taking
   USDC via x402 for our own invoices create MSB surface. **Do not self-clear.**
7. **npm token expires 2026-11-18** — act by ~2026-11-10. Unowned.
8. **PyPI publish for the Python SDK.** Never done.

## 6. Landmines

Each of these has already cost someone hours, and each **presents as a
different problem than it is**. The tell is the part that saves you.

| Landmine | The tell |
|---|---|
| **`CredentialVault` is FORCE RLS.** A read outside `withTenant(walletId, …)` returns *nothing* — silently. | Looks like missing data or a bad seed, never like an error. Two separate shipped bugs traced to exactly this. If a vault query returns empty and you are sure the row exists, check the tenant context first. |
| **PRs merge as squashes.** `git merge-base --is-ancestor` and `git cherry` both report merged work as unmerged. | A plain push from a main-rebuilt branch is rejected as non-fast-forward. Do **not** force-push — `git checkout -B <branch> origin/main && git merge -s ours origin/<branch>`. To ask "did my work land", compare **content**, never ancestry. |
| **`app/favicon.ico` must contain RGBA PNGs.** | Next decodes it for icon metadata and throws "The PNG is not in RGBA format" — which **500s every page**, not just the icon. Chromium screenshots are RGB unless captured with `omitBackground: true`. Check with `file app/favicon.ico`. |
| **Money units differ by layer.** Policy is stored in **cents**, the API and UI speak **dollars**, x402 quotes arrive in **atomic units**. | Off-by-1e6 results that look like a business-logic bug. Convert in integer math, never float. `lib/policy.ts` is the single conversion point. |
| **`decisionsThisMonth` is not error-swallowed** (unlike `recordDecision`). | A missing `WalletDecisionCounter` table surfaces as a **500 on `/dashboard/spend`**. Annoying in dev; useful in prod as a migration check. |
| **Preview builds inherit the production `DATABASE_URL`.** | `scripts/migrate-deploy.mjs` only migrates on Vercel *production* builds or with explicit `RUN_MIGRATE_DEPLOY=1`. Removing that guard would let a preview migrate the production database. |
| **Version literals live in more places than you expect.** | `package.json`, `packages/sanction-mcp/package.json`, `sdk/package.json`, `lib/mcpServer.ts`, `public/.well-known/mcp.json`, `packages/sanction-mcp/server.json` — **and the generated bundle `packages/sanction-mcp/mcp-server.js`, which inlines the constant and must be rebuilt with `npm run build:mcp`.** Missing that one kept CI red for six days. (`lib/walletCard.ts` derives from `MCP_SERVER_VERSION` and needs no edit.) Bump with `/cut-release`, not by hand. |
| **`npx prisma generate` is required after every clone.** | The client is gitignored. Without it you get import errors from `lib/generated/prisma` that read like a broken dependency tree. |

## 7. Decisions that are Eric's, not the sprint's

A cold agent should **stop and ask** rather than guess on any of these:

- Whether repo docs (README, `AGENTS.md`) adopt the services-firm identity
  that `/about` already carries.
- Pricing: Pro is **$20/mo metered in decisions**, early-access only until
  real billing ships — no checkout, lead capture labeled "early access",
  never bill replays. Free and enterprise-agreement framing unchanged.
- Anything touching custody or key-holding. Sanction is **veto-only**: it can
  refuse a transfer, never initiate one. That is both the architecture and
  the CLARITY §604 safe-harbor position. Do not design past it.
- Whether `main-backup-pre-jul4` may be deleted.

## 8. Slack OAuth — verified complete

Asked for explicitly. It is shipped and wired end to end (SLACK-1 slice 2):

| Piece | Path |
|---|---|
| Install start / callback | `app/api/slack/oauth/{start,callback}/route.ts` |
| Interactive Approve/Deny | `app/api/slack/interactive/route.ts` |
| Logic | `lib/slack.ts`, `lib/slackOAuth.ts` |
| Storage | `SlackInstall` model + `20260815120000_slack_install` migration |
| Entry point | **Add to Slack** button on `/dashboard/approvals` (`components/webhook-settings.tsx`) |
| Tests | `slack.test.ts`, `slack-interactive.route.test.ts`, `slack-oauth.test.ts`, `slack-oauth.route.test.ts`, plus `delivery.test.ts` |

How it behaves: HS256 state bound to the wallet (10 min TTL), admin session
required, `oauth.v2.access` must return `xoxb-` **and** an
`incoming_webhook.channel_id` or the install **fails closed**. The bot token
is stored SEC-1-encrypted on `SlackInstall` under RLS, unique per
(wallet, team). The channel is the ACL; the actor is recorded as
`slack:<username>`. `SANCTION_SLACK_BOT_TOKEN` stays a platform-wide fallback.

Env vars (names only — values live in Vercel env vars and the secrets store):
`SANCTION_SLACK_SIGNING_SECRET`, `SANCTION_SLACK_BOT_TOKEN`,
`SANCTION_SLACK_CLIENT_ID`, `SANCTION_SLACK_CLIENT_SECRET`. All four are in
`.env.example`. The interactive route **fail-closes with 503** when the
signing secret is unset, so a misconfigured environment refuses rather than
trusting unsigned payloads.

## 9. Getting running (commands that worked today)

```bash
npx prisma generate          # REQUIRED after clone; client is gitignored
npm run check                # tsc + eslint + vitest — expect 1189 passing
npm run dev                  # Next.js dev server (Turbopack)
```

Local Postgres with real data — the pattern that has worked all week:

```bash
# binaries: /usr/lib/postgresql/16/bin ; PGDATA: /var/lib/postgresql/16-data
# run initdb/pg_ctl as the `postgres` user; scratchpad dirs are not postgres-writable
# containers get reclaimed — re-check `pg_ctl status` before every DB-test run
DATABASE_URL=postgresql://sanction:sanction@localhost:5432/sanction_dev \
SANCTION_SIGNING_SECRET=dev-signing-secret-material \
SANCTION_CREDENTIAL_ENCRYPTION_KEY=dev-encryption-key-32-bytes-long! \
SANCTION_WALLET_ID=<seeded wallet id> npx next dev -p 3111
```

DB-backed tests need a real Postgres plus `RUN_DB_TESTS=1`
(`npm run test:db`). They prove what mocks cannot: budget atomicity under
concurrency, RLS isolation, the end-to-end data plane. **They are skipped in
the 1189 above** — 20 skipped tests are these.

To verify UI changes visually, use `/render-check`: Chromium is preinstalled
at `/opt/pw-browsers/chromium`; drive it with `playwright-core` and
`executablePath`. The repo's most expensive known failure mode is a visual
claim with no screenshot behind it.

## 10. Working style expected here

Encoded as callable skills in `.claude/skills/` — read `AGENTS.md` first,
then the skill you need:

`plan-gate` (plan before the first edit) · `live-state-truth` (verify against
the live system; docs and memory are stale by default) · `scope-fence`
(change what was asked, flag the rest) · `adversarial-verify` (attack your own
work before presenting it) · `ruthless-editor` (cut the prose) ·
`memory-hygiene` (date what you persist) · `/zoomout` (between arcs) ·
`/queue` (capture without derailing) · `/INPUT` (ingest outside material) ·
`/fresh-eyes` (this export) · `/truthsync` (drain story drift) ·
`/cut-release` · `/render-check` · `/audit` · `/tailwind` · `/voice-fence`.

Three engineering principles the codebase is actually built on
(canonical text in `docs/DOMAIN.md`):

1. **Identity stays upstream.** Sanction consumes canonical identity and
   mints governed runtime identity. It is never an identity of record — and
   funds stay upstream too.
2. **Atomic authorization.** Budget, policy, approval, grant, ledger and
   audit resolve together in one engine. The fusion is the moat, not either
   half.
3. **Determinism.** Same request + same policy revision + same state snapshot
   ⇒ same decision. Rules are pure so decisions replay and evidence holds.

Weigh new work against these three before writing it.
