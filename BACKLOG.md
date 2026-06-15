# Sanction — Backlog

> Prioritized, living. Scored **RICE** = (Reach × Impact × Confidence) ÷ Effort.
> Impact: 3=massive, 2=high, 1=med, 0.5=low. Confidence: 1.0/0.8/0.5. Effort in person-days.
> Re-rank every cycle as `docs/SIGNALS.md` changes. Ship in small branch→PR→green-CI→merge increments.

## ✅ Shipped (branch `claude/modest-albattani-620j27`, first security PR)
- **S-1** management-plane auth (`lib/ownerAuth.ts`, `sk_` key, `x-mgmt-key`) on `/agents`, `/credentials/vault`, `/wallets/stats`; bootstrap endpoint for legacy wallets → **closes P0 F1/F2, P1 F3**.
- **S-8** atomic budget checks (per-agent advisory lock in a transaction) on `/authorize` + `/tokens`; `Idempotency-Key` on `/authorize` → **closes V2a double-spend**.
- **F5** credential `expiresAt` enforced on `/inject`.
- **S-5** CI (typecheck + lint + audit) via `.github/workflows/ci.yml`; ESLint ignores generated artifacts; `.env.example` added.
- **S-4 (partial)** scrubbed live wallet id / key prefix from `AGENTS.md`. *Still TODO: rotate the AIIA agent key.*
- **S-7 (partial)** fixed dashboard env var + title. *Still TODO: JWT `iss` "autoflux"→"sanction" (needs a verify-both transition window since it's data-plane).*

## Now (P0/P1 — security & correctness; do before anything else)

| ID | Item | R | I | C | E | RICE | Source |
|----|------|---|---|---|---|------|--------|
| S-1 | **AuthN on management endpoints** (`/wallets`,`/agents`,`/vault`,`/stats`): owner management key (`sk_`) issued at wallet creation, required on management plane | 10 | 3 | 1.0 | 4 | **7.5** | THREAT F1–F4 |
| S-2 | **Default-deny credential allow-lists** (`allowedAgentIds` empty = none, not all) + enforce credential `expiresAt` on inject | 10 | 3 | 1.0 | 1 | **30** | THREAT F1,F5 |
| S-3 | **Execution-token revocation** endpoint + status checks | 8 | 2 | 1.0 | 1.5 | **10.7** | THREAT F6 |
| S-4 | **Scrub live identifiers** from `AGENTS.md`; rotate AIIA key; add `.env.example` | 10 | 1 | 1.0 | 0.5 | **20** | THREAT F9 |
| S-5 | **CI**: typecheck + lint + build on PR (GitHub Actions); add `npm audit` | 10 | 1.5 | 1.0 | 1 | **15** | DISCOVERY §8 |
| S-6 | **Tests**: unit (policy engine, crypto round-trip, JWT) + API integration on the auth gates | 10 | 2 | 0.8 | 4 | **4** | DISCOVERY §8 |
| S-7 | Fix dashboard env var (`PROXY_WALLET_ID`→`SANCTION_WALLET_ID`), finish AutoFlux→Sanction rename (JWT `iss`, title) | 8 | 1 | 1.0 | 0.5 | **16** | DISCOVERY §7 |
| S-8 | **Fix double-spend race**: atomic/transactional budget check on `/authorize` + `/tokens` (SELECT…FOR UPDATE or serializable tx) + `Idempotency-Key` support | 9 | 2.5 | 1.0 | 2 | **11.25** | FINDINGS V2a |
| S-9 | **Tenant isolation defense-in-depth**: Postgres RLS keyed on per-request tenant so a forgotten `where` can't leak across wallets | 7 | 2 | 0.8 | 3 | **3.7** | FINDINGS V2b |

## Next (close the gap between narrative and enforcement)

| ID | Item | R | I | C | E | RICE | Source |
|----|------|---|---|---|---|------|--------|
| N-1 | **Policy management API** (GET/PATCH policy: budgets, categories, thresholds) | 9 | 2 | 0.8 | 3 | **4.8** | PRODUCT §5 |
| N-2 | **Escalation resolution** (approve/deny escalated requests via API + dashboard) | 8 | 2 | 0.8 | 3 | **4.3** | PRODUCT §4 |
| N-3 | **Per-execution budget enforcement** (tie `/authorize` to `jti`, increment `spentUsd`, deny over budget) | 7 | 2 | 0.8 | 3 | **3.7** | THREAT F8 |
| N-4 | **Clearance enforcement** (gate scopes/categories by min clearance) + clearance assignment endpoint — or cut from narrative | 6 | 1.5 | 0.5 | 4 | **1.1** | DISCOVERY §6 |
| N-5 | **TS + Python SDK** (`@sanction/sdk`) encoding exec→inject correctly | 8 | 2 | 0.8 | 5 | **2.6** | PRODUCT §5 |
| N-6 | **Monthly budget enforcement** (README claims it; only daily exists) | 7 | 1 | 1.0 | 1 | **7** | PRODUCT §6 |
| N-7 | **Owner console** (manage wallets/agents/creds/policy in dashboard) | 7 | 2 | 0.6 | 8 | **1.05** | PRODUCT §5 |

## Later (scale, trust, monetization)

| ID | Item | R | I | C | E | RICE | Source |
|----|------|---|---|---|---|------|--------|
| L-1 | **Envelope encryption + KMS**, per-credential `keyId`, rotation; consider per-wallet data keys | 6 | 2 | 0.6 | 8 | **0.9** | THREAT F7 |
| L-2 | **Tamper-evident audit** (append-only/WORM sink or hash-chain) | 5 | 2 | 0.6 | 6 | **1.0** | THREAT |
| L-3 | **Rate limiting + per-key quotas** (edge) | 7 | 1 | 0.8 | 2 | **2.8** | THREAT F10 |
| L-4 | **Billing** (wire Stripe; enforce tier limits) | 5 | 1.5 | 0.6 | 5 | **0.9** | PRODUCT §6 |
| L-5 | **SOC 2 readiness** (controls, logging, vendor mgmt) | 4 | 2 | 0.5 | 20 | **0.2** | THREAT compliance |
| L-6 | **Real spend rails** (virtual cards / issuing or agent-payment protocol) — big strategic fork, see DECISIONS | 5 | 3 | 0.3 | 20 | **0.225** | MARKET |
| L-7 | **Webhooks/eventing** (notify owner on escalation, anomalous injection) | 6 | 1 | 0.7 | 3 | **1.4** | PRODUCT |

> First sprint recommendation: **S-2, S-4, S-7, S-1, S-5** (highest RICE among P0/P1, ordered for fast risk reduction).
