# Security

Sanction governs money, secrets, tool calls, and model access for autonomous
agents, so the security model is the product. This documents how it works as
shipped and where the edges are. Every claim below maps to enforcing code and a
regression test in [TRACEABILITY.md](./TRACEABILITY.md); the IDs in brackets are
that registry's rows. Last reconciled against `main`: 2026-09-02.

## Authentication planes

Every plane fails closed: a missing or wrong credential is a 401/403, and a
missing server secret is a 503, never an open door.

| Credential | Prefix / form | Header | Grants |
|---|---|---|---|
| Management key | `sk_` | `x-mgmt-key` | Owner plane: policy, agents, vault, approvals, webhooks, stats |
| Agent key | `pxy_` | `x-api-key` (`x-sanction-key` at the gateway; `Authorization: Bearer` at `/mcp`) | Data plane: authorize, log tokens, request execution, gateway, hosted MCP, broker |
| Execution token | HS256 JWT | `Authorization: Bearer` | Inject a scoped credential; cap one execution's spend |
| Human session | Better Auth (Google, GitHub, Apple) or a management-key cookie | session cookie | The dashboard, with a wallet role: `owner` / `admin` / `viewer` [WALLET-MEMBERS] |
| Slack action token | HS256 JWT in the button | Slack interactive payload | One Approve/Deny on one approval, bound to wallet + workspace + channel [SLACK-1] |

- Keys are shown **once** and stored only as **SHA-256 hashes**. A database
  leak does not expose usable keys. Rotation keeps history [SEC-6].
- Authorization rests on the secret, never on knowledge of an id. Wallet and
  agent ids are non-secret.
- Viewers cannot mutate; every dashboard mutation re-checks session, role, and
  that the target row belongs to the wallet.

## Credentials at rest [SEC-1, SEC-2]

- **Envelope encryption.** Each wallet has its own data-encryption key. In
  production it is wrapped by **AWS KMS**; locally and in CI it is wrapped by an
  environment master key so the same code path runs everywhere.
- Values are **AES-256-GCM** with a random 96-bit nonce, and the ciphertext is
  bound to its tenant and label through the GCM AAD, so a stolen blob cannot be
  replayed under another wallet or label.
- Wallet keys rotate (`POST /wallets/keys/rotate`); rows re-wrap lazily.
- Decrypted values leave the server only through `/credentials/inject` and
  the gateway's outbound provider header. They are never logged, and every
  response carrying a secret sets `Cache-Control: no-store` [SEC-13].
- **Reserved labels.** `provider:*` (connected provider keys) and `mcp:*`
  (broker upstream configs) are server-side only: `/exec` refuses them before
  any lookup, regardless of the row's allow-list or the agent's clearance, and
  the vault API will not create or rename onto them [PROV-1].

## Tenant isolation [SEC-3]

Vault, Slack install, and roster tables are under **Postgres row-level
security**. Every read or write runs inside a transaction that sets the tenant,
so a forgotten `where` clause returns nothing rather than another tenant's rows.
The application role must not be a superuser, or RLS is bypassed; the server
checks this at startup in production.

## Execution tokens [SEC-5]

- HS256, signed with `SANCTION_SIGNING_SECRET`; verification **pins the
  algorithm** and the audience (the wallet).
- The JWT's `jti` **is** the execution-token row id, so DB-side revocation
  (`POST /exec/revoke`) is immediate.
- Default TTL 15 minutes, maximum one hour. Injection is scope-limited to the
  token's labels, clearance-gated (agent clearance ≥ the credential's bar),
  rejects expired credentials, and writes an audit row per access with no raw
  value.
- Spend under a token is capped by its hard budget; `/authorize` re-reads the
  token under the agent's lock and debits atomically.

## Decision engine [SEC-4, EVID-1]

- Rules are pure over their context; the enforcement shell reads state inside
  a **per-agent advisory lock** and, for subtree caps, uses conditional atomic
  counter updates, so concurrent calls cannot both pass and overshoot.
- `Idempotency-Key` replays the original decision, never a double spend.
- Every decision stores the policy revision and the exact context it evaluated;
  `GET /authorize/{id}/evidence` replays the pure rules and proves the outcome
  reproduces.
- Denials and escalations carry a stable machine code plus remediation.

## Human approvals

Escalations become a `PendingApproval`; approval mints a **single-use, expiring
grant** the agent redeems on retry. Policy timeouts guarantee a terminal
outcome (default: deny). The actor is recorded on every resolution — a signed-in
human, or `slack:<username>` for a Slack click.

**Slack.** Add to Slack runs OAuth v2 with a state token bound to the admin's
wallet. The bot token is stored under the wallet's envelope. Interactive clicks
are verified with Slack's `v0` HMAC over the raw body (five-minute skew), rate
limited, and matched to the installed workspace and channel. **Anyone in the
connected channel can decide** — the channel is the approver group. The
endpoint returns 503 if the signing secret is unset.

## Webhooks and outbound fetches [WEBHOOK-SIG, WEBHOOK-SSRF]

- Machine deliveries are signed **HMAC-SHA256** over the exact body
  (`x-sanction-signature`). Slack incoming-webhook URLs are the one exception;
  Slack's URL is its own secret.
- Registered URLs must be public `https`; loopback, private ranges, and
  metadata hosts are rejected at registration.
- Delivery and MCP-broker forwarding fetch with `redirect: "manual"`: a
  validated host cannot redirect a later call onto an internal address. The
  broker answers an upstream redirect as a 502, never a hop.

## Hosted MCP and the broker [MCP-REMOTE-1, BROKER-1]

- `https://getsanction.com/mcp` authenticates the agent key from headers only,
  fails closed with 401, and is rate limited before authentication.
- The broker fronts an upstream MCP server: every `tools/call` is authorized
  before a byte reaches the upstream, batches that smuggle a `tools/call` are
  refused, and outbound headers are built from scratch, so the agent's Sanction
  key is never forwarded. The upstream's own credential stays vaulted and is
  injected server-side.

## Abuse controls [RATE]

Unauthenticated wallet creation, login, and the Slack endpoints are rate
limited per IP with a DB-backed fixed window that holds across serverless
instances.

## Audit evidence [AUDIT-EXPORT]

`GET /audit/export` returns a hash-chained, HMAC-signed snapshot of decisions.
`POST /audit/verify` recomputes the chain and signature self-contained, naming
the first broken link if any row was altered, dropped, or reordered.

## Known limitations

- Single region. Execution tokens are HS256 with one signing secret; asymmetric
  signing is on the roadmap.
- The rate limiter is a fixed window; a couple of requests can slip at a
  boundary.
- A charge that escalates and is later approved is not retroactively debited
  from a short-lived execution token.
- Interception holds for traffic through the gateway and the broker. The plain
  wallet URL and stdio MCP server are cooperative: the host must ask.
- Slack approver authority is channel membership, not a Sanction role.

## Reporting a vulnerability

Email **eric@getsanction.com**. Please do not open a public issue for security
reports. We acknowledge, fix, and appreciate coordinated disclosure.
