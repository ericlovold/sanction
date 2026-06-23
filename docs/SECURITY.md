# Security

Sanction governs money, secrets, and model access for autonomous agents, so the
security model is the product. This documents how it works and where the edges are.

## Authentication planes

Three credentials, each fail-closed:

| Credential | Prefix | Header | Grants |
|---|---|---|---|
| Management key | `sk_` | `x-mgmt-key` | Owner plane: policy, agents, vault, approvals, webhooks, stats |
| Agent key | `pxy_` | `x-api-key` | Data plane: authorize, log tokens, request execution, gateway |
| Execution token | JWT | `Authorization: Bearer` | Inject a scoped credential; cap a single execution's spend |

- Keys are shown **once** at creation and stored only as **SHA-256 hashes**. A
  database leak does not expose usable keys.
- All authorization rests on the secret, never on knowledge of an id. Wallet/agent
  ids are treated as non-secret; supplying one you don't hold a key for gets you nothing.
- A wallet with no management-key hash (legacy) **fails closed** — it cannot be
  managed until bootstrapped.

## Credentials at rest

- **AES-256-GCM**, key derived (SHA-256) from `SANCTION_CREDENTIAL_ENCRYPTION_KEY`.
- Ciphertext is bound to its tenant+label via **GCM AAD** (`<walletId>:<label>`), so a
  stolen blob can't be replayed under a different wallet or label — the tag check fails.
- Versioned ciphertext (`v1`) for forward migration.
- Decrypted values are returned only through `/credentials/inject` and never logged;
  responses carrying secrets set `Cache-Control: no-store`.

## Execution tokens

- **HS256 JWT**, signed with `SANCTION_SIGNING_SECRET`. Verification **pins the
  algorithm** (`algorithms: ["HS256"]`) — no `alg: none` / alg-confusion.
- The JWT's `jti` **is** the execution-token row id; injection looks the token up by it.
- Short TTL (default 15 min, max 1 h) **and** DB-backed status — the owner can
  **revoke** a token before expiry and inject refuses anything not `active`.
- Injection is **scope-limited** (only labels in the token), **clearance-gated**
  (agent clearance ≥ the credential's `minClearance`), rejects expired credentials,
  and is **audit-logged** per access (no raw value in the log).
- Spend under a token is capped by its **hard budget**: `/authorize` re-reads the token
  under a per-agent lock, denies `EXEC_BUDGET_EXCEEDED` when exceeded, and debits
  atomically on approval.

## Decision engine

- Daily token/spend budget checks run inside a **per-agent advisory lock** with a
  re-read, so concurrent calls can't both pass and overshoot a cap.
- **Idempotency-Key** dedupes retries — a replay returns the original decision, never a
  double-spend.
- Denials carry a stable machine-readable `code` + remediation so agents replan instead
  of hallucinating on a bare 403.

## Webhooks

- Every delivery is signed **HMAC-SHA256** over the exact body (`x-sanction-signature`);
  verify it before trusting an event.
- Registered URLs are **SSRF-guarded** — `https://` only, loopback / private / metadata
  hosts rejected.

## Abuse controls

- Unauthenticated wallet creation and login are **rate-limited** per IP (fixed window).
- Tenant isolation: every query is wallet-scoped; cross-tenant reads/writes are not
  reachable by id guessing.

## Known limitations (and roadmap)

- Single region; no SSO yet (planned for teams/enterprise).
- The rate limiter is a fixed-window approximation (a couple of requests can slip at a
  window boundary) — fine for abuse prevention; a precise limiter is a later upgrade.
- An execution budget debits on auto-approval; a charge that escalates and is later
  approved by a human is not retroactively debited (exec tokens are short-lived).
- The gateway forwards the agent's provider key today; a vault-injected mode (the agent
  never holds the provider key) is planned.

## Reporting a vulnerability

Email **eric@getsanction.com**. Please don't open a public issue for security reports.
We'll acknowledge and work a fix; coordinated disclosure appreciated.
