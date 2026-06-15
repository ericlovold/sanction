# Sanction — Day-One Security Findings

> Answers to the founder's existential day-one checks (V1 key custody, V2 spend concurrency & tenant isolation, V3 audit integrity), each with **code evidence** and severity. Companion to the full `SECURITY-THREAT-MODEL.md`. Verified at commit `e3e7269`.
>
> **Headline:** no secrets are committed to git history (verified), and the credential-injection core is well-built. But there is a **live, unauthenticated credential-disclosure chain** (THREAT F1, P0), a **double-spend race** on every budget check (V2, P1), **single-key custody with no rotation** (V1, P1), and **non-tamper-evident audit** (V3, P1). None are blockers to fixing; all are blockers to claiming the product is secure.
>
> **🔧 Remediation status (branch `claude/modest-albattani-620j27`):**
> - ✅ **F1/F2/F3 fixed** — management-plane auth (`x-mgmt-key`) now gates `/agents`, `/credentials/vault`, `/wallets/stats`; the disclosure chain is closed (an attacker can no longer mint an agent). Pre-existing wallets fail closed; bootstrap via `POST /wallets/bootstrap-key`.
> - ✅ **V2a fixed** — `/authorize` & `/tokens` budget checks are now atomic (per-agent advisory lock in a transaction) + idempotency-key support.
> - ✅ **F5 fixed** — `/inject` rejects expired credentials.
> - ⏳ **Still open:** V1 (key custody/envelope — L-1), V2b (Postgres RLS — S-9), V3 (tamper-evident audit — L-2), F6 (revocation), F7 (asymmetric JWT), default-deny allow-list flip (needs AIIA backfill), rotate AIIA key.

---

## V1 — Master-key custody & GCM nonce handling — **P1** (P0 if multi-tenant secrets onboard)

**Evidence:** `lib/jwt.ts:35-39`
```ts
function getEncryptionKey(): Buffer {
  const key = process.env.SANCTION_CREDENTIAL_ENCRYPTION_KEY
  if (!key) throw new Error("SANCTION_CREDENTIAL_ENCRYPTION_KEY not set")
  return createHash("sha256").update(key).digest()   // one global key, derived from one env var
}
```

| Check | Finding | Verdict |
|---|---|---|
| Where does the root key live? | **Single Vercel env var** `SANCTION_CREDENTIAL_ENCRYPTION_KEY`. No KMS/HSM. | ⚠ A leak of one env var decrypts the **entire** vault — the exact catastrophe the product exists to prevent. |
| Envelope encryption / per-tenant data keys? | **No.** One key encrypts every credential for every wallet. `encryptCredential` (`jwt.ts:41`) uses it directly. | ⚠ No blast-radius isolation; no `keyId` stored with ciphertext, so rotation is impossible without re-encrypting everything blind. |
| GCM nonce uniqueness? | `iv = randomBytes(12)` per call (`jwt.ts:43`) — **random 96-bit nonce**. | ✅ Acceptable. Random 96-bit IVs are the GCM-recommended construction; reuse probability is negligible at this volume. Becomes a concern only at very high write volume per key (birthday bound ~2³² messages) — another reason to move to per-tenant keys. |
| Key rotation path? | **None.** No `keyId`, no re-encrypt routine, no rotation runbook. | ⚠ Cannot rotate without downtime/guesswork. |
| Decrypted secrets logged/cached/leaked? | `/inject` returns the plaintext once in the JSON body and writes only an audit row (no value) — `credentials/inject/route.ts:54-66`. No logging of the value found. | ✅ Good — value is not persisted or logged server-side. (Client/transport handling is out of scope.) |

**Fix (BACKLOG L-1):** envelope encryption with a KMS-managed master key; store `keyId` per credential; per-wallet data keys for isolation. Move JWT signing to asymmetric (EdDSA) so verifiers can't mint (V-tokens below).

---

## V2 — Spend concurrency & tenant isolation

### V2a — Double-spend race (TOCTOU) — **P1, newly identified**
**Evidence:** `app/api/v1/authorize/route.ts:56-79` (and the same pattern in `tokens/route.ts:32-49`)
```ts
const dailySpend = await db.authorizationRequest.aggregate({ ...sum approved today... })  // READ
if (dailyTotalCents > policy.dailySpendBudgetUsd) { ...deny... }                          // CHECK
...
await db.authorizationRequest.create({ ...status: "approved"... })                        // WRITE
```
The budget is a **stateful counter checked with read-then-write and no transaction, row lock, or idempotency key.** Two concurrent `/authorize` calls both read the same pre-spend total, both pass the check, and both write `approved` — **blowing the daily cap**. Identical race on the daily *token* budget (`tokens/route.ts`). Also **no idempotency key**, so a client retry double-records a spend.
- **Impact:** the core promise ("agents can't exceed their budget") is violatable under normal concurrency — and an attacker can deliberately fan out requests to exceed caps.
- **Fix (BACKLOG → new S-8):** enforce in a single transaction with `SELECT … FOR UPDATE` on a per-agent/wallet ledger row (or a serializable transaction / atomic conditional update); add an `Idempotency-Key` header honored on `/authorize` and `/tokens`. Precedence of policy rules is otherwise clear and correct (deny-list → per-tx max → daily → escalate → approve).

### V2b — Tenant isolation by app-code only — **P1**
**Evidence:** every query scopes by `walletId`/`agentId` in application code (e.g. `exec/route.ts:32-37`, `credentials/inject/route.ts:46-48`, `wallets/stats/route.ts`), and `lib/db.ts` connects as a single Postgres role. **There is no Postgres Row-Level Security.** Isolation depends entirely on every developer remembering the right `where` clause forever.
- Combined with the **unauthenticated** management endpoints (THREAT F1–F4), cross-tenant access is not merely theoretical today — `GET /credentials/vault?wallet_id=…` and `GET /wallets/stats?wallet_id=…` already return another tenant's data for any wallet id.
- **Fix:** (1) close the auth holes (S-1); (2) defense-in-depth: Postgres RLS keyed on a per-request tenant GUC so a forgotten `where` cannot leak across wallets.

---

## V3 — Audit-log integrity — **P1** (gates the enterprise story)

**Evidence:** `AuthorizationRequest` and `CredentialInjection` (`schema.prisma:136-165`) are ordinary mutable Postgres rows in the same database the app writes to with full privileges. Good news: **every** sensitive decision *is* recorded — authorize decisions (`authorize/route.ts`, all branches), injections (`inject/route.ts:54`), exec issuance (`exec/route.ts:59`). Gap: the log is **not tamper-evident** — anyone with DB write access (or an app-level SQL bug) can edit or delete records, and there is **no export path**.
- "Everything is logged" only has governance value to a compliance buyer if the log is **append-only / hash-chained** evidence. Today it is convenience logging, not evidence.
- **Fix (BACKLOG L-2):** append-only audit (separate restricted role / WORM sink) or hash-chain each record (`prevHash`); add a signed audit-export endpoint (the thing Enterprise pays for).

---

## Bonus findings surfaced during the day-one pass

- **JWT is symmetric (HS256), single shared secret** (`jwt.ts:18-31`). Any party that can *verify* a token can also *mint* one. Fine while verification happens only inside Sanction, but if exec-token verification is ever pushed to an agent host/container, move to **asymmetric EdDSA/RS256** and per-tenant keys. (THREAT F7.)
- **No exec-token revocation endpoint** despite `status`/`revokedAt` being checked — a leaked JWT lives its full TTL with no kill switch. (THREAT F6 → BACKLOG S-3.)
- **Credential `expiresAt` not enforced on inject.** (THREAT F5 → S-2.)
- **No rate limiting / anomaly detection** on auth or authorize endpoints. (THREAT F10 → L-3.)
- **Agent API-key bootstrap:** long-lived `pxy_` keys, shown once, SHA-256-hashed at rest (good), but no rotation endpoint and no per-key revocation beyond flipping `isActive` in the DB. The bigger issue is they can currently be *minted without auth* (F1).

## Severity roll-up

| Sev | Items |
|---|---|
| **P0** | Unauthenticated agent registration → credential disclosure (THREAT F1); unauthenticated vault (F2) |
| **P1** | Double-spend race (V2a); tenant isolation app-code-only (V2b); single-key custody/no rotation (V1); non-tamper-evident audit (V3); unauthenticated stats (F3) |
| **P2** | No revocation (F6); expiry not enforced (F5); HS256 single secret (F7); per-execution budget unenforced (F8) |
| **P3** | Committed prod identifiers (F9); no rate limiting (F10); clearance modeled-not-enforced |

> Recommendation: fix in this order — **F1/F2 (auth) → V2a (double-spend) → S-7 hygiene → V1/V3 (key & audit hardening)**. The first two are exploitable today against the live deployment.
