<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Sanction — Project Context for AI Sessions

## What This Is

**Sanction** is the trust and governance layer for autonomous AI agents — a wallet, credential vault, and clearance system that travels with the agent. Before an agent spends money, invokes a tool, or accesses credentials, it asks Sanction; Sanction decides (approve / escalate / deny), logs, and audits everything.

**Tagline:** *Authorize. Protect. Govern.*

## Commands

```bash
npx prisma generate        # REQUIRED after clone or schema change — client is
                           # generated into lib/generated/prisma (gitignored)
npm run dev                # Next.js dev server (Turbopack)
npm run check              # Full gate: tsc --noEmit && eslint && vitest run
npm run lint               # ESLint only
npm test                   # Unit tests (vitest run)
npx vitest run tests/policy.test.ts   # Single test file
npx vitest run -t "name"              # Single test by name
npm run test:coverage      # Coverage with ratchet thresholds (see below)
npm run test:db            # DB-backed tests (tests/*.db.test.ts) — needs a real
                           # Postgres in DATABASE_URL + RUN_DB_TESTS=1, plus
                           # SANCTION_SIGNING_SECRET / SANCTION_CREDENTIAL_ENCRYPTION_KEY
npm run build              # prisma generate + guarded migrate + next build
npm run build:mcp          # esbuild-bundle mcp-server.ts → packages/sanction-mcp/mcp-server.js
npx prisma migrate dev     # Create a migration after editing prisma/schema.prisma
bash scripts/smoke.sh      # End-to-end smoke test against a live deployment
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, `test:coverage`, and the DB tests against an ephemeral Postgres 16 service on every push/PR. `publish-mcp.yml` is a manual workflow that publishes `packages/sanction-mcp` to npm.

**Migration safety:** `npm run build` calls `scripts/migrate-deploy.mjs`, which only runs `prisma migrate deploy` on Vercel *production* builds or with explicit `RUN_MIGRATE_DEPLOY=1` opt-in — preview builds inherit the prod `DATABASE_URL` and must never migrate it. `prisma.config.ts` gives the Prisma CLI a *direct unpooled* connection (Neon's PgBouncer can strand the migration advisory lock); the data plane keeps the pooled URL via `@prisma/adapter-pg` in `lib/db.ts`.

## Architecture

### Authentication planes (all fail closed)

1. **Agent data plane** — `x-api-key: pxy_...` header, SHA-256-hashed lookup (`lib/auth.ts` → `authenticateAgent`). Used by `/authorize`, `/tokens`, `/exec`, credential injection.
2. **Management plane** — wallet owner's `sk_` management key via `x-mgmt-key` header or Bearer (`lib/ownerAuth.ts` → `authenticateOwner`). Gates agent creation, policy, vault, stats. Shown once at wallet creation; legacy wallets bootstrap via `POST /wallets/bootstrap-key`.
3. **Execution JWTs** — short-lived (15 min) scoped tokens issued by `POST /exec` (jose, HS256; `lib/jwt.ts`), required as Bearer for `POST /credentials/inject`.
4. **Human dashboard** — Better Auth (Google/GitHub, `lib/auth-config.ts`) *or* a legacy httpOnly cookie holding the `sk_` key; both are bridged to the same Wallet in `lib/session.ts` so the rest of the app never cares which.

### Policy decision engine (ADR-0009)

- `lib/evaluation.ts` — pure rules engine: a rule returns a `RuleResult`; the engine folds an ordered list into one `Decision` (deny-overrides → escalate → allow). Rules are **pure over their context — no IO**. State reads, persistence, and obligation execution live in the enforcement shell (the route handlers), which pre-fetch budget state into the context and run the rules inside a Postgres advisory lock.
- `lib/rules/` — rule ladders per action type: `spend.ts` (the reference implementation), `tool.ts` (MCP tool governance), `credential.ts`, `provision.ts`.
- `lib/decisions.ts` — typed `DecisionCode`s (`PER_TXN_LIMIT`, `GRANT_EXPIRED`, …) derived from persisted `(status, decisionNote)` so idempotent replays return the same code. **Keep these in sync with the `decisionNote` strings written in `app/api/v1/authorize/route.ts`** — agents replan on stable machine codes.
- Escalations create a `PendingApproval` (`lib/approvals.ts`); approval mints a single-use, TTL'd `Grant` the agent redeems on retry (`lib/grants.ts`). Policy controls timeout behavior (`escalation_timeout_action`: approve/deny).
- Budgets cascade through the wallet tree (`lib/cascadeBudget.ts`, `lib/accountTree.ts`): wallets nest parent→child, subtree daily caps are enforced at `/authorize`, counters live in `WalletBudgetCounter`.

### LLM Gateway

`app/api/gateway/[provider]/[...path]/route.ts` + `lib/gateway.ts` — agents point their model SDK's base URL at `/api/gateway/<provider>` with an `x-sanction-key` header. Sanction forwards to the real provider (anthropic/openai/…), reads token usage off the response, and meters it against the agent's budget — zero per-call instrumentation. Over-budget returns 402.

### Credential vault security

- **SEC-1 envelope encryption** (`lib/kms.ts`, `lib/credentialCrypto.ts`): per-wallet DEKs wrapped by AWS KMS in production (`SANCTION_KMS_KEY_ARN`); when unset (local/CI/preview), DEKs wrap with the env master key so the envelope path works without AWS.
- **SEC-3 Row-Level Security** (`lib/rls.ts`): `withTenant(walletId, fn)` sets a transaction-local GUC that Postgres RLS policies key on — vault queries can only see that tenant's rows even if a `where` clause is forgotten. The app's DB role must be non-superuser or RLS is bypassed.

### Data model & persistence

Prisma 7 with `@prisma/adapter-pg` driver adapter; schema in `prisma/schema.prisma`, client generated into `lib/generated/prisma` (gitignored — never hand-edit, regenerate). Money convention: **policy is stored in cents; the API and UI speak dollars** — `lib/policy.ts` is the single validation/conversion point shared by the REST endpoint and dashboard server actions. The Better Auth models (`User`, `Session`, `Account`, `Verification`) match that library's contract exactly — do not rename fields.

### Surfaces

- `app/api/v1/*` — REST API (see README for the endpoint table; `lib/openapi.ts` holds the full OpenAPI 3.0 spec served at `/api/openapi.json`, Bedrock-compatible).
- `app/dashboard/*` — operator console: server components reading the DB directly, with mutations in per-page `actions.ts` server actions.
- `mcp-server.ts` — MCP stdio server source, bundled via `npm run build:mcp` into `packages/sanction-mcp/` (published to npm as `sanction-mcp`, MIT-licensed; the rest of the repo is FSL-1.1-MIT).
- `docs/` — user-facing integration guides (Quickstart, Gateway, LangChain, CrewAI, Vercel AI SDK, multi-tenant runbook, SECURITY.md for the threat model), plus `docs/DOMAIN.md` — the canonical ubiquitous-language glossary mapping every concept (Wallet, Agent, Policy, Grant, Clearance…) to its Prisma model and code path, with the authorization lifecycle. Read it before naming things.
- `examples/` — client examples; `examples/eve-testers` is its own package, excluded from the root tsconfig.

### Testing conventions

- Unit tests mock Prisma (`vi.mock("@/lib/db")`) and `withTenant`; route handlers are imported and invoked directly with `NextRequest`. Rules are pure precisely so they unit-test without a DB.
- `tests/*.db.test.ts` run against real Postgres (gated by `RUN_DB_TESTS=1`) and prove what mocks can't: concurrency/budget-leak atomicity, RLS isolation, the end-to-end data plane.
- Coverage thresholds in `vitest.config.ts` are a **ratchet** — set just below current coverage; raise as coverage grows, never lower.

## Conventions & Gotchas

- **Engineering principles** (canonical text in `docs/DOMAIN.md` § Engineering
  principles; confirmed by Eric 2026-07-04): (1) Identity stays upstream —
  Sanction consumes canonical identity and mints governed runtime identity,
  never an identity of record. (2) Atomic authorization — budget, policy,
  approval, grant, ledger, audit resolve together in one engine; the fusion
  is the moat, not either half. (3) Determinism — same request + same policy
  revision + same state snapshot ⇒ same decision; rules stay pure so
  decisions can be replayed and evidenced. Weigh new work against these.
- Path alias `@/*` maps to the repo root (both tsconfig and vitest).
- `_`-prefixed variables/args are intentionally unused (ESLint is configured for this).
- `.npmrc` sets `legacy-peer-deps=true` — expected, don't "fix" it.
- Never commit production wallet ids or API keys. Live identifiers live in Vercel env vars and the secrets store.
- `walletId` is treated as non-secret; authorization rests entirely on keys, never on knowledge of ids.

## Environment Variables

See `.env.example` for the authoritative list (copy to `.env.local` for dev). Core: `DATABASE_URL` (Neon), `SANCTION_SIGNING_SECRET`, `SANCTION_CREDENTIAL_ENCRYPTION_KEY`, `SANCTION_WALLET_ID` (demo wallet for the public dashboard). Optional: `SANCTION_KMS_KEY_ARN` + AWS creds (SEC-1 prod root of trust), `BETTER_AUTH_*` + Google/GitHub OAuth (human sign-in).

## Live Production

- **API:** `https://getsanction.com/api/v1` — canonical domain `getsanction.com`
- **Dashboard:** `https://getsanction.com` · **OpenAPI:** `https://getsanction.com/api/openapi.json`
- **Hosting:** Vercel (`lovold` team, project `sanction`); DB is Neon via Vercel integration
- **Bedrock Agent:** `JXRNIJRMCX` (us-east-1), Action Group `sanction-api`
- **npm:** `sanction-mcp` (published; `npx sanction-mcp`)

## Session Skills

`.claude/skills/` vendors six rigor skills (plan-gate, adversarial-verify,
live-state-truth, scope-fence, ruthless-editor, memory-hygiene) from Iwo's
Rigor Pack v1.0.0 — provenance and review record in `.claude/skills/README.md`.
They encode this repo's working style: evidence before plans, verify against
the live system, fence your diffs, cut your prose, date your memory.
`zoomout` is homegrown: Eric's between-arcs ritual (resync, re-read the
product's claims, rank next best actions) as a callable skill. `queue` is
homegrown too: capture a mid-arc thought/idea/question into `docs/BACKLOG.md`
(dated, public-repo-safe phrasing) without derailing the current work; the
backlog drains through `/zoomout`. Kept verbatim for clean upstream diffs;
repo-specific guidance belongs here, not in the skill files.
`voice-fence` is homegrown too: the AI coaches structure and strategy on
anything a human will read as Eric's own words, but never drafts them —
public, linkable, universal phrasing (no repo specifics).
`input` is homegrown too (added 2026-07-10, named for Short Circuit's
"INPUT!"): `/INPUT` ingests raw material Eric vouches for — strategy notes,
sprint output, snippets, live coding suggestions — splits it into pieces,
routes each to where it lives (working tree / backlog / AGENTS.md proposal /
conversation-only for sensitive), applies what's live after verifying against
the code as it is, and ends with a per-piece disposition report (APPLIED ·
QUEUED · PROPOSED · HELD · PUSHED BACK). Ingestion with judgment, not
dictation — and never a silent drop. /queue captures a one-liner; /INPUT
digests a payload.
`cut-release`, `render-check`, `truthsync`, and `tailwind` are homegrown too
(added 2026-07-12, from a behavior scan of recurring rituals): `/cut-release`
runs the release ritual — verify tags vs main, bump + changelog stamp as its
own PR, notes + prefilled publish link, verify Latest — so version/tag drift
can't recur. `/render-check` is proof-by-pixels: seed a demo org, next dev,
Chromium screenshots of the named pages, attach evidence — no screenshot, no
"fixed." `/truthsync` drains story drift: diff merged PRs since the last
release stamp against changelog/roadmap/README/DOMAIN/TRACEABILITY and
propose the catch-up as one docs-only PR (/zoomout detects, /truthsync
fixes; run before every /cut-release). `/tailwind` is the market-event
playbook: verify the news at primary sources, map it to engine primitives +
roadmap ("hold the mandate, not the rail"), ship a fenced same-day slice or
degrade gracefully to mapping + backlog arc, and flag the GTM moment.
`audit` is homegrown too (adapted 2026-07-07 from the "AI Code Sanity Check"
audit-prompt suite): `/audit [topics…]` runs read-only best-practice
investigations — 29 topics, 0–5 maturity score + amateur/AI-built signal
each — writing evidence-backed reports to the gitignored `audit/` directory;
a full run fans out one subagent per topic and rolls up `audit/SCORECARD.md`.

## Session Ops Notes (dated — prune when stale)

- As of 2026-07-04: PRs merge as SQUASHES here. After your PR merges, the
  remote work branch still holds pre-squash commits that are NOT in main's
  ancestry — a plain push from a main-rebuilt branch gets rejected as
  non-fast-forward. Do not force-push; absorb instead:
  `git merge -s ours origin/<branch>` then push (lossless — content is in main).
- As of 2026-07-04: to verify dashboard UI by rendering: seed local Postgres,
  set `SANCTION_WALLET_ID=<seeded wallet id>` (+ DATABASE_URL, signing/crypto
  envs), `npx next dev`, then screenshot with the preinstalled Chromium via
  playwright-core (`executablePath: /opt/pw-browsers/chromium`). The demo-view
  path renders /dashboard read-only without login.
- As of 2026-07-04: local Postgres 16 binaries live at
  /usr/lib/postgresql/16/bin; run initdb/pg_ctl as the `postgres` user with
  PGDATA under /var/lib/postgresql (scratchpad dirs are not postgres-writable).
  Containers are reclaimed — re-check `pg_ctl status` before every db-test run.

## Business Context

- Owner: Eric Lovold (solo founder). Primary agent client: AIIA Brain (Mac Mini agent; its integration lives outside this repo in `~/aiia-brain`).
- Distribution: MCP (npm), AWS Bedrock Action Groups, direct REST API, LLM gateway.
- Model: it's free, or it's an agreement. Free covers individuals (no card, personal + production use); anything beyond that is a negotiated enterprise agreement, not a tier sheet. Confirmed 2026-07-04.
- Primary intended use case (confirmed by Eric 2026-07-08): governing an
  org's **own internal** AI usage and spend — teams/departments as wallets,
  budgets, chargeback, hard enforcement — not only platforms embedding
  Sanction in shipped products. The current storefront under-expresses this
  (it reads embedded/production-agent first); closing that gap is queued in
  `docs/BACKLOG.md`. Weigh copy and docs changes against this intent.

## Design Direction

- Dark theme, zinc/slate palette. Minimal, serious, enterprise-appropriate — not playful.
- Data-dense dashboard — operators want numbers, not marketing copy.
- Brand: Sanction = authorized + constrained. Trust through limits.
