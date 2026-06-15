# Sanction — Security & Threat Model

> Sanction holds credentials and authorizes spend — **security is the product**. A leaked secret or a broken isolation boundary is existential. This document threat-models the system as built (commit `e3e7269`) and ranks findings by severity. Findings are verified against code; file:line references included.

## TL;DR — what needs attention now

| # | Severity | Finding | Status |
|---|---|---|---|
| F1 | **P0** | Unauthenticated `POST /agents` + publicly-known `wallet_id` → attacker mints a valid agent key → exec JWT → **decrypts vault credentials** with empty allow-lists | **Live exposure** |
| F2 | **P0** | `POST/GET /credentials/vault` unauthenticated — anyone with a `wallet_id` can write credentials and list credential metadata | Live |
| F3 | **P1** | `GET /wallets/stats` unauthenticated — financial/usage data leaks for any `wallet_id` | Live |
| F4 | **P1** | `POST /wallets` unauthenticated, unthrottled — spam/DoS, no account model | Live |
| F5 | **P1** | Credential `expiresAt` not enforced on injection — expired secrets still injectable | Code gap |
| F6 | **P2** | No execution-token revocation endpoint — cannot kill a leaked live JWT | Missing |
| F7 | **P2** | Single global symmetric keys (HS256 + one AES key), no rotation, no envelope/KMS | Design |
| F8 | **P2** | Per-execution `budgetUsd` never enforced (`spentUsd` never incremented) | Code gap |
| F9 | **P3** | Production `wallet_id` + API-key prefix committed to `AGENTS.md` | Hygiene |
| F10 | **P3** | No rate limiting anywhere; clearance modeled but never enforced | Design |

**Positive baseline:** no secrets/`.env` in git history (verified `git log --all --diff-filter=A`); API keys stored only as SHA-256 hashes; AES-256-GCM is correctly constructed; the *injection* endpoint itself is properly JWT-gated, scope-checked and audited.

---

## System overview for threat modeling

- **Assets:** vault credentials (highest value), agent API keys, execution JWTs, spend authority, audit integrity, usage/financial data.
- **Trust boundaries:** (1) public internet → REST API; (2) agent host → MCP server → API; (3) API → Postgres; (4) execution container → `/inject`.
- **Identities:** Wallet (owner, `ownerEmail` unique, *no login*), Agent (`x-api-key`), Execution context (Bearer JWT, `jti`).
- **Note on `wallet_id`:** it is a CUID and is treated by the system as **non-secret** — it is the dashboard env var and is published in `AGENTS.md` (`cmqefleko000004ieyqrer393`). Any control that relies on `wallet_id` being unguessable is therefore broken by design.

---

## F1 — P0: Credential-disclosure chain via unauthenticated agent registration

**Where:** `app/api/v1/agents/route.ts:12` (`POST` has no `authenticateAgent`), combined with `exec` allow-list logic at `app/api/v1/exec/route.ts:39-43` and the default empty `allowedAgentIds` in `schema.prisma:81`.

**Attack:**
1. Attacker knows a `wallet_id` (it's published, or guessable for any target who exposes it).
2. `POST /api/v1/agents { wallet_id, name }` → server returns a **working `pxy_` API key** bound to the victim wallet. No auth required.
3. `POST /api/v1/exec { scope:[label], budget_usd, ttl }` with that key. For any credential whose `allowedAgentIds` is empty (the schema default → "all agents in wallet"), the new attacker agent **passes the allow-list check**.
4. `POST /api/v1/credentials/inject` with the returned JWT → **decrypted plaintext credential** returned, plus a benign-looking audit row.

**Impact:** full disclosure of any wallet credential that wasn't explicitly pinned to specific agent ids. On the live deployment with the published wallet id, this is exploitable today against any credential stored with default scoping.

**Fix:** require authentication to create agents. An agent must not be able to self-register a sibling. Options (recommend A):
- **(A) Owner-scoped session/console auth for management endpoints** (`/wallets`, `/agents`, `/credentials/vault`, `/stats`): introduce a wallet-owner credential (a `sk_`-style **management key** returned once at wallet creation, or real user auth) and require it on all management routes. Keep `pxy_` agent keys for runtime endpoints (`/authorize`, `/tokens`, `/exec`, `/inject`) only.
- **(B)** Short-term mitigation: make `allowedAgentIds` **default-deny** (empty = no agents, must opt in) so step 3 fails. Reduces blast radius but doesn't fix the open registration hole.

---

## F2 — P0: Unauthenticated credential vault

**Where:** `app/api/v1/credentials/vault/route.ts` — both `POST` and `GET` lack any auth check.

- `POST`: anyone with a `wallet_id` can inject credentials into a victim's wallet (pollution; could be used to plant attacker-controlled values an agent later trusts).
- `GET`: lists credential metadata (labels, types, scopes, allowed agent ids, expiry) for any `wallet_id` — reconnaissance that directly feeds F1 (tells the attacker which labels to request and which have empty allow-lists).

**Fix:** require owner management auth (see F1-A). Vault writes/lists are management-plane operations; only injection is data-plane.

---

## F3 / F4 — P1: Unauthenticated stats and wallet creation

- `GET /wallets/stats` (`wallets/stats/route.ts:5`): returns spend, token cost, recent authorizations and pending approvals for any `wallet_id`. Confidential business data, no auth.
- `POST /wallets` (`wallets/route.ts:10`): open, unthrottled wallet creation. No account/ownership model means no rate limit or abuse control. **Fix:** gate stats behind owner auth; put wallet creation behind sign-up + rate limiting (and tie `ownerEmail` to a real authenticated user).

---

## F5 — P1: Credential expiry not enforced

**Where:** `credentials/inject/route.ts:46-51` fetches the credential but never compares `credential.expiresAt` to now. A rotated/expired secret remains injectable until manually deleted. **Fix:** reject injection when `expiresAt && expiresAt < now`; surface as 410/403.

## F6 — P2: No revocation path

`ExecutionToken.status`/`revokedAt` are checked on inject (`inject/route.ts:41`) — good — but **no endpoint sets them**. A leaked JWT lives its full TTL (up to 60 min) with no kill switch. **Fix:** `POST /exec/:jti/revoke` (owner-auth) setting `status=revoked, revokedAt=now`.

## F7 — P2: Key management

- One symmetric HS256 secret signs all JWTs; one AES key (derived `sha256(env)`) encrypts all credentials for all tenants. No rotation, no per-tenant keys, no envelope encryption, no KMS/HSM. Compromise of `SANCTION_CREDENTIAL_ENCRYPTION_KEY` decrypts **every** credential.
- `getEncryptionKey()` (`lib/jwt.ts:35`) folds an arbitrary-length env value through SHA-256 — acceptable as a KDF substitute, but there is no salt and no key id stored alongside ciphertext, so rotation would require re-encrypting everything with no way to tell which key a record used.
- **Fix (roadmap):** envelope encryption with a KMS-managed master key; store a `keyId` per credential to enable rotation; consider per-wallet data keys for blast-radius isolation. Move JWT signing to asymmetric (EdDSA) so verifiers never hold signing material.

## F8 — P2: Per-execution budget not enforced

`ExecutionToken.budgetUsd`/`spentUsd` exist but `/authorize` is not associated with an execution token and `spentUsd` is never written. The "capped spend per execution" guarantee is currently cosmetic. **Fix:** optionally accept a `jti` on `/authorize`, atomically increment `spentUsd`, and deny when an approval would exceed the token budget.

## F9 — P3: Secrets hygiene in repo

`AGENTS.md:97` commits the production `wallet_id` and an API-key **prefix** (`pxy_7356614f...`). The prefix alone is not the key (the secret is 32 random bytes), but the wallet id is the linchpin of F1–F4. **Fix:** scrub live identifiers from committed docs; rotate the AIIA agent key as precaution; treat wallet ids as low-sensitivity but don't publish production ones.

## F10 — P3: Rate limiting & clearance enforcement

- No throttling on auth-key verification or any endpoint → brute-force/DoS surface. **Fix:** edge rate limits + per-key quotas.
- Clearance (1–5, industry) is stamped into JWTs but never checked. Until enforced it's a false sense of control. **Fix:** gate credential scopes / spend categories on minimum clearance, or drop the claim from the product narrative until wired.

---

## Abuse / compromise scenarios (beyond the findings)

- **Compromised agent host:** with a stolen `pxy_` key, attacker can request exec JWTs for any allow-listed credential and spend up to policy limits. Mitigations that matter: tight `allowedAgentIds`, short TTLs, per-execution budget enforcement (F8), revocation (F6), and anomaly alerting on injection frequency.
- **Audit integrity:** `CredentialInjection` rows are the system of record but live in the same DB with no append-only/tamper-evidence. An attacker with DB access can both read secrets and erase the trail. **Fix (roadmap):** ship audit events to an append-only/WORM sink (or hash-chain them).
- **Supply chain:** `mcp-server.js` is a 1.3 MB committed bundle — verify it is reproducibly built from `mcp-server.ts` before publishing to npm; pin and review the MCP SDK. No lockfile audit step in CI (there is no CI).

## Compliance posture (forward-looking)

Calling it a "wallet" and charging for it raises questions the product must answer before enterprise/regulated buyers: SOC 2 Type II (table stakes for selling a secrets product), data-residency for credentials, and — **if Sanction ever actually moves funds** — money-transmission / PCI exposure. Today it only authorizes and logs, which keeps it out of money-transmitter territory; that boundary should be a deliberate, documented decision (see `DECISIONS.md`).
