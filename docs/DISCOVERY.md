# Sanction — Discovery (Phase 1)

> Status: first-pass discovery, **verified against the repo at commit `e3e7269`** (branch `claude/modest-albattani-620j27`). Every capability claim below is tagged **REAL** (working code), **STUBBED** (data model or hook exists but not enforced/wired), or **ASPIRATIONAL** (claimed in README/marketing, no code).

## 1. What Sanction is (verified)

Sanction is a **trust-and-control plane for autonomous AI agents**: a policy-driven spend authorizer, an encrypted credential vault gated by short-lived scoped tokens, and an audit log. It does **not** custody or move money today — it *authorizes* and *records* spend decisions; there are no payment rails wired in (the `stripe` dependency is unused). It is best described, as-built, as an **agent authorization + secrets-injection + audit API**, not a wallet that holds funds.

## 2. Stack & topology

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router, Turbopack) + TS | `next.config.ts` sets turbopack root only |
| ORM/DB | Prisma 7 + `@prisma/adapter-pg` → Postgres (Neon) | client generated to `lib/generated/prisma` (gitignored) |
| Hosting | Vercel (`build` runs `prisma generate && prisma migrate deploy && next build`) | migrations applied at build time |
| Auth | SHA-256-hashed API keys (`pxy_` prefix); JWT exec tokens (jose, HS256) | |
| Crypto | Node `crypto` AES-256-GCM for credentials at rest | |
| Distribution | REST API, MCP stdio server (`mcp-server.js`), AWS Bedrock action group | OpenAPI 3.0 spec served at `/api/openapi.json` |

**Surface area is small and legible:** 8 REST endpoints, 1 dashboard page, 1 MCP server (5 tools), 8 data models. ~1,500 lines of hand-written app code (the 1.3 MB `mcp-server.js` is a bundled artifact).

## 3. Component map

```
app/
  page.tsx                       Dashboard (server component, reads DB directly)  REAL (one bug, §7)
  api/openapi.json/route.ts      Serves lib/openapi.ts spec                       REAL
  api/v1/
    wallets/route.ts             POST create wallet (+default policy)   REAL · UNAUTHENTICATED
    wallets/stats/route.ts       GET dashboard stats by wallet_id       REAL · UNAUTHENTICATED
    agents/route.ts              POST register agent / GET list         REAL · UNAUTHENTICATED  ⚠ P0
    authorize/route.ts           POST spend policy engine               REAL (core, solid)
    tokens/route.ts              POST log token usage + budget check     REAL
    exec/route.ts                POST issue scoped execution JWT         REAL
    credentials/vault/route.ts   POST store / GET list credentials      REAL · UNAUTHENTICATED  ⚠ P0
    credentials/inject/route.ts  POST inject decrypted cred (Bearer JWT) REAL (JWT-gated, good)
lib/
  db.ts        Prisma singleton                                  REAL
  jwt.ts       issue/verify JWT + AES-256-GCM encrypt/decrypt    REAL (issuer still "autoflux")
  auth.ts      authenticateAgent() via x-api-key                 REAL
  apiKey.ts    generateApiKey()/hashApiKey() — SHA-256, pxy_     REAL
  openapi.ts   OpenAPI 3.0 spec object                           REAL
prisma/schema.prisma + 2 migrations                              REAL
mcp-server.ts → mcp-server.js (5 tools)                          REAL
```

## 4. Data model (verified from `schema.prisma`)

```
Wallet (1)──(N) Agent ──(1) AgentClearance        [clearance: level 1-5, industry]
   │            │
   │            ├──(N) TokenLog                     [model, tokensIn/Out, costUsd]
   │            ├──(N) AuthorizationRequest         [action, amountUsd, status]
   │            └──(N) ExecutionToken ──(N) CredentialInjection ──(1) CredentialVault
   ├──(1) Policy                                    [budgets, per-tx max, escalate, allow/block categories]
   └──(N) CredentialVault                           [encryptedValue, allowedAgentIds, scopes, expiresAt]
```

The model is well-considered: separates issuance (`ExecutionToken`, keyed by `jti`) from access (`CredentialInjection` audit rows), supports per-credential agent allow-lists and scopes, and carries clearance/industry. Quality of schema is **above** the quality of enforcement (see §6).

## 5. Trust & data flows

**Spend authorization (REAL, end-to-end):**
```
Agent --x-api-key--> POST /authorize
  authenticateAgent() → load agent + wallet.policy
  policy gate: no-policy=deny → blocked category=deny → > per-tx max=deny
            → daily spend over budget=deny → > escalateOver=escalate → else auto-approve
  every decision persisted to AuthorizationRequest (audit)
```

**Credential injection (REAL, two-step, JWT-gated):**
```
1) Agent --x-api-key--> POST /exec {scope:[labels], budget_usd, ttl}
     verify each label exists in wallet AND (allowedAgentIds empty OR includes agent)
     issue HS256 JWT (jti, 15min) + persist ExecutionToken row
2) Container --Bearer JWT--> POST /credentials/inject {credential_label}
     verify JWT → label ∈ scope → ExecutionToken active & not expired
     decrypt AES-256-GCM → return plaintext → write CredentialInjection audit row
```
This is the strongest part of the system: scoped, short-lived, audited, and the raw value only leaves the boundary against a valid execution token.

## 6. What's solid / stubbed / missing

**Solid (REAL):**
- AES-256-GCM construction is correct: random 12-byte IV, GCM auth tag stored, `iv|tag|ciphertext` base64 (`lib/jwt.ts`).
- API keys never stored raw; SHA-256 hash unique-indexed; raw shown once on creation.
- Policy engine logic is sound and every decision is persisted (good audit posture).
- Injection path is properly JWT-gated, scope-checked, expiry-checked, and audit-logged.
- Clean separation of concerns; Zod validation on every endpoint body.

**Stubbed (model/field exists, NOT enforced):**
- **Clearance levels** — `AgentClearance` is read in `/exec` and stamped into the JWT, but *nothing ever checks clearance* to gate a credential, category, or action. There is **no endpoint to assign clearance**. "Industry-specific domain authorization" is data-only. → ASPIRATIONAL in practice.
- **Per-execution budget** — `ExecutionToken.budgetUsd`/`spentUsd` exist; `spentUsd` is never incremented and `/authorize` is not tied to an execution token. The "capped budget per execution" claim is not enforced.
- **Credential expiry** — `CredentialVault.expiresAt` is stored but **not checked** on injection; expired credentials are still injectable.
- **Token revocation** — `ExecutionToken.revokedAt`/`status` are checked on inject, but no endpoint sets them → no way to revoke a live token.
- **Escalation resolution** — requests go to `escalated`, but there is no endpoint to approve/deny them (no human-in-the-loop completion path; `decidedAt` never set for escalations).
- **Policy management** — wallets get default policy on create; there is **no endpoint to read or update a policy**. Budgets are fixed at defaults unless edited in DB.

**Missing entirely:**
- **AuthN/AuthZ on `/wallets`, `/agents`, `/wallets/stats`, `/credentials/vault`** — these have *no* authentication (see SECURITY-THREAT-MODEL.md; one of these enables a live credential-disclosure chain — P0).
- No tests, no CI (`.github/` absent), no `.env.example`.
- No rate limiting, no account/user model (a `Wallet` is identified only by unique `ownerEmail`; no login).
- No monetization plumbing (Stripe imported, never used); pricing tiers in README are not enforced anywhere.
- No SDK; integration is raw REST or MCP only.

## 7. Bugs found in passing

- **Dashboard env var mismatch (functional):** `app/page.tsx:44` reads `process.env.PROXY_WALLET_ID`, but AGENTS.md/README document `SANCTION_WALLET_ID`. Unless both are set, the production dashboard renders "PROXY_WALLET_ID not set". (Also the dashboard `<h1>` still says "AutoFlux".)
- **Incomplete rename:** JWT `iss` is `"autoflux"` (`lib/jwt.ts`); dashboard title "AutoFlux"; GitHub repo still `autoflux`. Cosmetic but user-visible.
- **README base URL:** documents `https://onesanction.com/api/v1` — the canonical live domain (`sanction.ai` not pursued).

## 8. Test / CI / branch state

- **Tests:** none. **CI:** none (`.github/` does not exist). **Coverage:** 0%.
- **Branches:** `main`, `claude/modest-albattani-620j27` (this work). Working tree clean.
- **History:** 7 commits; MVP landed as one big `feat`, then a rename AutoFlux→Sanction (incomplete), then docs. Last push 2026-06-15.

## 9. Honest assessment

Sanction is a **clean, coherent MVP of a genuinely interesting category** with a notably good schema and a correct credential-injection core. The gap is **enforcement and access control**: the marquee features (clearance, per-execution budgets, escalation workflow, policy management) are modeled but not wired, and four endpoints ship with no authentication — one of which (`POST /agents` against a *published* wallet id) is a live credential-disclosure path. The product story ("wallet") currently over-states the build (authorization + audit, no funds movement). Closing the auth gaps and wiring the stubbed enforcement would convert this from "convincing demo" to "defensible product."

See: `PRODUCT.md`, `SECURITY-THREAT-MODEL.md`, `ROADMAP.md`, `BACKLOG.md`.
