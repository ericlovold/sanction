# Domain Model & Ubiquitous Language

> The shared vocabulary for Sanction — every core concept mapped to the Prisma
> model that backs it and the code path that enforces it. Written for engineers
> and AI coding agents so we all use the same words for the same things.
>
> **Provenance:** distilled from a Codex discovery sprint (2026-07-02) and then
> verified line-by-line against `prisma/schema.prisma`. Where the sprint's mental
> model diverged from the shipped schema, this file follows the code and flags the
> gap. If the schema changes, update this file in the same PR.

**One sentence:** Sanction is the authorization and governance control plane for
AI agents — it governs both **inference** (token spend) and **actions**
(purchases, provisioning, tool calls, credential access), enforcing policy
*before* anything happens.

---

## The platform, as five systems

```
                   AI Agent
                      │  x-api-key: pxy_…
        ┌─────────────┴─────────────┐
   Gateway                    Authorization
 token metering              policy decisions
 provider routing            approve / escalate / deny
        │                           │
        └─────────────┬─────────────┘
                      │
              Governance layer
        wallets · budgets · policies
        clearance · grants · audit trail
                      │
             Management plane
                sk_ key
```

| System | What it does | Primary code |
|--------|--------------|--------------|
| **Gateway** | Meters token spend, routes provider calls | `app/api/gateway/`, `app/api/v1/tokens/route.ts` |
| **Authorization** | The decision engine — allow / escalate / deny on every request | `app/api/v1/authorize/route.ts`, `lib/decisions.ts` |
| **Governance layer** | Wallets, budgets, policies, clearance, grants, the audit trail | `prisma/schema.prisma`, `app/api/v1/wallets/` |
| **Management plane** | Owner-only admin: create agents, manage vault/policy, read stats | `sk_` management key, `lib/auth.ts` |
| **Runtime credential** | The agent's identity in the field | `pxy_` API key, `lib/apiKey.ts` |

---

## Ubiquitous language

Legend: **Shipped** = a real model/field enforced in code today · **Derived** =
a real concept expressed through other models (no dedicated table) · **Roadmap** =
named in the discovery doc but not yet a first-class entity.

| Concept | Status | Backing model / field | Where it lives |
|---------|--------|-----------------------|----------------|
| **Wallet** | Shipped | `Wallet` | Budget container **and** the account-tree node (`parentId` self-relation). The ownership root. |
| **User** | Shipped | `User` (Better Auth) | Human identity from Google/GitHub sign-in; owns one or more Wallets. |
| **Agent** | Shipped | `Agent` | Runtime identity under a Wallet. Optional per-agent budget overrides. Product-facing name: **Seat** (next row). |
| **Seat** | Derived | `Agent.holder` / `Agent.expiresAt` + `AgentClearance` + rotation | The product contract over `Agent` (SEATS-1): an occupiable identity you hand to whoever holds it — named holder, contractor auto-expiry (the key fails closed past the date), rotation that moves the holder while history/budgets/clearance stay with the seat, batch creation from one template. Dashboards and the PWA say **Seat**; the schema and API paths keep the `Agent` noun. |
| **Agent Key (`pxy_`)** | Shipped | `Agent.apiKeyHash` / `apiKeyPrefix` | Runtime credential; presented as `x-api-key`. SHA-256 hashed at rest. |
| **Management Key (`sk_`)** | Shipped | `Wallet.mgmtKeyHash` / `mgmtKeyPrefix` | Administrative credential; gates the management plane. Shown once at creation; rotated via `MagicLink`. |
| **Policy** | Shipped | `Policy` (one per Wallet) | The rules: spend ladder, tool/resource allow-block-escalate lists, escalation timeout + fallback action. |
| **Authorization Request** | Shipped | `AuthorizationRequest` | A decision request. `kind` = `spend` \| `provision`; `status` = pending/approved/denied/escalated. `idempotencyKey` dedupes retries. |
| **Decision** | Derived | `AuthorizationRequest.status` + `/authorize` response | Not a table — it's the terminal status plus a machine-readable `DecisionCode` and `REMEDIATION` hint from `lib/decisions.ts`. |
| **Pending Approval** | Shipped | `PendingApproval` | The waiting state. Generic across spend/tool/credential/future actions — anything that escalates to a human lands here. |
| **Grant** | Shipped | `Grant` | Ephemeral authority minted from a human approval. The agent retries with it; single-use (`consumedAt`). The audit answer to "who authorized this, under what constraints?" |
| **Budget Pool** | Derived | `Wallet` tree + `Policy.subtreeDailyCapUsd` + `WalletBudgetCounter` | "Shared allocation" = caps cascade down the Wallet tree; `WalletBudgetCounter` enforces subtree caps atomically. Surfaced at `/dashboard/pools`. No `Pool` table. |
| **Clearance** | Shipped | `AgentClearance` | 1–5 level + `industry` (healthcare/legal/financial/…). An agent accesses a credential only if its clearance ≥ `CredentialVault.minClearance`. |
| **Credential Vault entry** | Shipped | `CredentialVault` | AES-256-GCM encrypted secret. Never returned raw — only injected under a scoped execution token. |
| **Wallet Key (DEK)** | Shipped | `WalletKey` | Per-wallet data-encryption key, stored **wrapped** (KMS in prod, env-master locally). Envelope encryption for the vault; supports rotation + versioning. |
| **Execution Token** | Shipped | `ExecutionToken` | Short-lived (15-min TTL) scoped JWT (`jti` = id). Bounds which credentials an execution may inject and its spend authority. |
| **Credential Injection** | Shipped | `CredentialInjection` | Immutable audit row: which credential was injected under which execution token, when. Never hard-deleted. |
| **Webhook** | Shipped | `Webhook` | Owner endpoint notified on approval/escalation/budget events; HMAC-SHA256 signed. |
| **Audit Event** | Partial | *(distributed — see below)* | No unified `AuditEvent` table today. The decision stream exports as a signed, hash-chained, tamper-evident document (AUDIT-1: `GET /v1/audit/export`, verified self-contained via `POST /v1/audit/verify`); across-time chain anchors are AUDIT-2 (Later). |
| **Organization** | Roadmap | *(the Wallet tree fills this role)* | No `Organization` model. Org → tenant → sub-tenant is modeled as a self-nesting `Wallet` hierarchy. |

---

## Ownership & the account tree

The discovery doc puts an **Organization** at the root. In the shipped schema
there is no such model — **`Wallet` is the root, and it nests into itself**:

- `Wallet.parentId` → self-relation `WalletTree`. `null` = a root wallet.
- Subtree reporting rolls spend **up**; `/authorize` enforces opt-in subtree caps
  down (`Policy.subtreeDailyCapUsd`, tracked by `WalletBudgetCounter`).
- A `User` (Better Auth human identity) owns one or more Wallets; a Wallet is
  claimed by email on first social sign-in (`lib/session.ts`).

So "who owns everything" is answered by **User → Wallet(root) → child Wallets →
Agents**, not by an Organization entity. Use *Wallet tree* for the hierarchy;
reserve *organization* for prose only.

---

## The authorization lifecycle

Grounded in `app/api/v1/authorize/route.ts` + `lib/decisions.ts`. Amounts in cents.

```
Authorization Request (POST /api/v1/authorize)
        │
   No policy? ───────────────► DENIED        ("No policy configured" — default deny)
        │
   Policy spend ladder (Policy model):
     amount ≤ autoApproveUnderUsd .................. APPROVED (silent)
     autoApproveUnderUsd < amount ≤ escalateOverUsd  APPROVED
     escalateOverUsd < amount ≤ perTransactionMaxUsd ESCALATED → human
     amount > perTransactionMaxUsd ................. DENIED (hard cap)
        │
   ┌────┴─────────────┬───────────────────────────┐
APPROVED           ESCALATED                     DENIED
   │                  │                             │
 execute      PendingApproval (waiting)          stop
                      │
              human approves/denies
                      │  approve
                 Grant minted (active)
                      │
              agent retries /authorize with grant_id
                      │
                 Grant validated & consumed → APPROVED → execute
                      │
                 Grant expires / revoked (terminal)
```

**Design invariants worth stating explicitly (all enforced in code):**

- **Default deny / fail closed.** No policy → deny. A `deny` gate is terminal.
  Escalations that no human resolves within `escalationTimeoutMins` settle to
  `escalationTimeoutAction` (default `deny`) on the next read — no deadlocks.
- **Runtime enforcement.** The decision happens *inline*, before the
  provider/merchant/tool call — not after the fact in a log.
- **Small trusted surface.** Most flows reduce to **Authorize → Approve → Grant →
  Retry**. Same shape for spend, provision (`kind="provision"`), and tools
  (`/authorize/tool`).
- **Idempotency.** `AuthorizationRequest.idempotencyKey` is unique per agent; a
  retry replays the original decision rather than double-charging.
- **Grants, not direct execution.** A human approval doesn't execute the action —
  it mints a one-use `Grant` the agent must retry with. Cleaner to audit and replay.

---

## The audit surface (there is no single "Audit Event")

The discovery doc lists one immutable **Audit Event** stream. Today the trail is
**distributed across purpose-built, append-only tables** — each answers a
different question:

| Question | Table |
|----------|-------|
| What did this agent spend on tokens? | `TokenLog` |
| Which credential was injected, when, under what execution? | `CredentialInjection` |
| Who authorized this action, under what constraints? | `Grant` |
| What scoped authority was issued for this execution? | `ExecutionToken` |
| What decision did policy return, and why? | `AuthorizationRequest` (status + note) |

The **decision stream is exportable as signed evidence** (AUDIT-1, shipped):
`GET /v1/audit/export` returns the wallet's `AuthorizationRequest` history as a
hash-chained, HMAC-signed document, and `POST /v1/audit/verify` re-checks it
self-contained — altering, dropping, or reordering any row names the first
broken link. The other tables remain separate streams (a unified export across
all of them, plus chain anchors *across* exports, is AUDIT-2). Treat "the audit
trail" as this set of tables, with decisions exportable as tamper-evident
evidence.

---

## Positioning notes (validated)

The discovery doc's strategic framing checks out against `lib/roadmap.ts` and is
worth keeping as canonical positioning:

- **Preventive, not observability.** "Your agent *cannot* do this until policy
  says yes" — not "here's what your agent did."
- **The MCP wedge.** "Govern any MCP tool" (shipped, `now`) puts Sanction inline
  as the enforcement point for the MCP ecosystem: LLM → Sanction → policy →
  approve → tool.
- **The arc.** Today: govern spend + provisioning + tool actions through one
  engine. Next: human approval everywhere + local deployment (Sanction Local).
  Later: cryptographic audit + customer-managed keys + payment-rail neutrality.
- **Across platforms, not inside one.** Incumbents optimize governance inside
  their own platform. Sanction optimizes authorization across platforms —
  providers, payment rails, identities, and agent ecosystems.

## Engineering principles

Three invariants that prevent roadmap drift. Copy and code both answer to them:

- **Identity stays upstream.** Sanction consumes canonical identity (Better
  Auth users, upstream IdPs) and mints governed runtime identity (seats,
  `pxy_` keys). Two different identity domains; the output is always an
  authorization decision, never an identity of record.
- **Atomic authorization.** Budget, policy, approval, grant, ledger, and
  audit resolve together, in one engine, under one lock. Bolting approvals
  onto an external PDP recreates the race conditions, stale budgets, and
  replay problems this fusion eliminates. The approval loop only works
  because it is the same code path as the decision.
- **Determinism.** The same request, against the same policy revision and
  state snapshot, always produces the same decision. Rules are pure over
  their context (ADR-0009) precisely so decisions can be replayed, debugged,
  and evidenced.

See `lib/roadmap.ts` for the live Now/Next/Later — it already reflects all of the
above; this section is the *why*, not a second source of truth.
