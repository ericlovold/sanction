# Sanction — Decision Log (ADRs)

> Lightweight, append-only architecture/product decision records so direction changes are traceable. Format: Date · Status · Context · Decision · Consequences. Newest first. "Proposed" items need a human call (flagged ⚑).

---

## ADR-0009 ACCEPTED — Policy Decision Engine: `(action, context) → Decision` as the core primitive
**Date:** 2026-06-30 · **Status:** Accepted (contract/design; reference implementation = spend refactor, pending). Evaluator seeded in `lib/evaluation.ts` (feature branch).
**Context:** Sanction's primitive is generalizing from *"can an agent spend money?"* to *"can an agent
perform **this action**?"* — where an action is spend, credential injection, an MCP tool call, an LLM
request, a deploy, an email, a shell command. From the engine's view they're all `(action, context)`.
This is the difference between a financial-governance feature and an **authorization layer for autonomous
systems**. The move is incremental by design (the abstraction should emerge from production use, not a
framework introduced before we know what rules need). The load-bearing risk isn't the pipeline — it's the
**decision algebra**: what a rule returns, how results compose, and how side effects are honored. That
contract is what everything composes on and is expensive to change later, so it is fixed here before the
engine extends past spend. Existing wallet/budget/credential/gateway work is **preserved and wrapped**,
not rewritten (strangler-fig): spend becomes the first implementation of a general engine, not a special
case. Do **not** out-build the policy-language incumbents (Cedar/OPA/Oso); the moat is agent-native
context (principal = agent with wallet/clearance/budget/history), a first-class **escalate** effect, and
every decision being metered + audit-logged inline (PDP+PEP fused), not a library to integrate.
**Decision:** Adopt the following contract.
- **Effects:** `allow | deny | escalate`. **Combining rule (explicit): deny-overrides → escalate → allow.**
  First rule to `deny` wins; else any `escalate` wins; else `allow`.
- **Two distinct types** — a rule's local verdict vs. the engine's composed output:
  ```ts
  type RuleResult = {
    effect: "allow" | "deny" | "escalate"
    ruleId: string
    code: string                 // machine-stable; REQUIRED on deny/escalate — this IS the audit trail
    reason?: string              // human-readable
    obligations?: Obligation[]   // honored ONLY if this rule is on the winning path
  }
  type Decision = {              // engine output
    effect: "allow" | "deny" | "escalate"
    ruleId: string               // the deciding rule
    code: string
    reason?: string
    obligations: Obligation[]    // accumulated from permit/escalate rules only; EMPTY on a deny
  }
  ```
- **Obligation lifecycle (the sentence people get wrong):** a `deny` **discards all obligations** (a denied
  spend must never `reserve_budget`). Obligations accumulate **only** along `allow`/`escalate` rules that
  survive composition. Each obligation carries `enforcement: "required" | "advisory"`.
  ```ts
  type Obligation = { enforcement: "required" | "advisory" } & (
    | { type: "reserve_budget"; scope: "agent" | "wallet_tree"; amount_cents: number }
    | { type: "audit_log"; event: string }
    | { type: "human_approval"; count?: number; approvers?: string[]; timeout_mins?: number; on_timeout: "allow" | "deny" }
    | { type: "no_egress"; destinations?: string[] }
    | { type: "require_reviewers"; count: number }
  )
  ```
  `human_approval` carries its own timeout (ties to ADR-0008 — an escalate with no fallback is a hung agent).
- **Enforcement is a PEP capability, not a property of the decision** (corrects the first draft, which wrongly
  baked `no_egress` into the contract as "Sanction Local–exclusive"). The PDP emits obligations universally;
  each **PEP advertises which obligation types it can enforce** — Sanction Local → `no_egress`; the LLM gateway
  → `reserve_budget`; a GitHub PEP → `require_reviewers`; a webhook-only PEP → `audit_log` only.
  **Fail-closed rule:** if `effect` is `allow`/`escalate` but the acting PEP cannot enforce a **required**
  obligation, the enforcement layer **downgrades the outcome** (to `escalate`, else `deny`) — permitting while
  silently dropping a required control is a false security guarantee. Unenforceable **advisory** obligations
  are logged and skipped. The decision contract stays **universal**; enforcement capability varies by runtime.
- **The `Action` object is the formal counterpart to `Decision`** — the engine's input primitive. Wallets/spend
  are one `type`; the same object carries every action class:
  ```ts
  type Action = {
    id: string
    type: "spend" | "credential.use" | "mcp.invoke" | "llm.generate" | "tool.execute" | "email.send"
    subject: AgentRef
    resource?: ResourceRef
    context: { tenantId: string; walletId?: string; clearance?: number; metadata: Record<string, unknown> }
  }
  ```
  Evaluation-time environment (`now`, `region`) is passed to the evaluator alongside the Action (rules like
  "weekdays only" read it). The whole engine reduces to one stable pipeline:
  ```text
  Action → Rules → Decision → Obligations → Enforcement (PEP) → Audit
  ```
  Wallets are one resource type; the shape is meant to survive adding `mcp.invoke`, `llm.generate`, filesystem,
  GitHub deploys, email, DB writes without changing.
- **Reference implementation = spend.** The ADR-0007 ladder becomes `RuleResult`s (category, per-txn, agent
  budget, parent budget, execution budget, escalation); the ADR-0008 timeout becomes the `human_approval`
  obligation; budget hold becomes `reserve_budget`. **Acceptance bar for Milestone 1: zero external behavior
  change + full existing test parity.** The engine earns the right to generalize by proving on spend first.
**Roadmap:** M1 spend (reference) → **soak in prod on real traffic** → M2 **MCP tool authorization** (second
proof; first non-money action; interception point we already own) → M2.5 credentials (the clearance rules
*are* the regulated/healthcare story) → M3 enterprise composable rules (north star; likely adopt Cedar/OPA
under the hood rather than invent a DSL). Portfolio discipline: Sanction + AIIA-local-brain = **active**;
XCAi-AIIA (tenant/RLM patterns) + aiia-console (Rust keystore → future Sanction Local UI) = **quarry/dormant**,
harvested not revived.
**Consequences:** Combining semantics + obligation lifecycle are now the frozen contract — changing them
later is a breaking migration, so they are deliberate here. `code` required on deny/escalate makes the audit
log (the enterprise differentiator) trustworthy by construction. The narrative may lead the shipped surface
by exactly one step (say "authorization for agent actions"; ship spend+credentials+gateway+MCP) — not ten;
promising enforcement everywhere before we're inline is the stall mode. `getsanction.com/local` is a to-build
landing since the story now leads the code. Internally this is an **Agent Authorization Platform** — wallets are
one resource type among many (credentials, MCP tools, LLM usage, filesystem, deploys, email, DB writes);
externally we still sell spend governance + Sanction Local first and let the platform emerge from what customers
already buy (SPINE.md). The `Action ↔ Decision` symmetry plus the PEP-capability model is the intended
years-stable core: incumbents (Cedar/OPA/OpenFGA) supply policy infrastructure but aren't opinionated about
agents, budgets, human escalation, or governed execution — the differentiation is integrating authorization +
execution + metering + audit around AI agents, not inventing a policy language.

**Addendum (M4+) — the Authorization Boundary + human approval as an ephemeral Grant.** Every governed request
passes through six ordered layers; each answers one question and only its own:

```text
Authentication   — who is this principal?          (API key / session)
Capability       — is this a valid capability?      (JWT validity, audience, execution-token status, token scope)
Authorization    — should this principal do this?   (the decision engine — evaluate(action, context))
Obligations      — what must accompany a permit?    (audit_log, no_store, reserve_budget, human_approval…)
Enforcement      — carry out the decision           (persist, lock, decrypt, debit — per PEP)
Audit            — record what happened
```

**Invariant — the *Authorization Boundary* (named so future ADRs/PRs can reference it):**
> The decision engine SHALL NOT authenticate principals or validate credentials. It evaluates authorization
> ONLY for an already-authenticated principal acting on an already-validated capability.

Corollary: JWT validity, audience, execution-token status, and token scope are **capability guards**, not rules —
they run before the engine and never move into it (enforced today by a route test: an out-of-scope
`/credentials/inject` returns 403 before the credential lookup or any engine call). Conflating "is this token
valid" with "should this action be allowed" makes the security semantics impossible to reason about and lets
error precedence drift.

**Human approval resolves an `escalate` into an ephemeral Grant (Model A).** An `escalate` is not a held request —
you cannot decrypt a secret and wait. It is *deny-now, pending owner approval, retry-after*:
```text
Decision → escalate → PendingApproval → owner approves → Grant → agent retries → Grant consumed
```
`Grant` is a **generic primitive**, not per-action — the same object gates an approved purchase, credential label,
tool invocation, or a future deploy/email:
```ts
type Grant = {
  id; actionType; subject; resource; constraints; expiresAt; consumedAt
  // provenance — the auditor's answer to "why was this allowed?"
  issuedBy; issuedFromApproval; justification
}
```
Provenance is not optional: in a regulated review "a grant existed" is not an answer; "Jane Smith approved
`apr_1234` at 14:37 UTC after reviewing the escalation" is. The generic shape also leaves room for later
delegation/revocation without a schema change (not built now).

**Rejected.** (B) *Policy mutation* — approving one action must never rewrite org policy; that turns every approval
into configuration drift and conflates "let this agent read this secret" with "change our security posture."
(C) *Persistent approved-request state* — works for spend only because the request *is* the object; it becomes an
awkward special case the moment credential/tool/deploy approvals exist.

**ActionType emerges here, not before.** The approval loop is the second consumer that forces a real answer to
"what is an action?" — `PendingApproval` and `Grant` both need an `actionType` discriminator. The `ActionType`
registry (required context, rules, default obligations, enforcement points) grows out of that lived need, not a
speculative design from three young endpoints.

**Consequences:** This crosses Sanction from *making authorization decisions* to *governing human authorization
workflows for autonomous systems* — a category move. Build order: (1) this addendum, (2) generic `PendingApproval`,
(3) generic `Grant`, (4–6) spend/tool/credential consume grants, (7) notification adapters (email/webhook/Slack).
Spend's existing escalation behavior is preserved; tool and credential graduate from decision-only to a real loop.

## ADR-0008 ACCEPTED — Escalation timeout: no agent deadlocks on an unresolved escalation
**Date:** 2026-06-20 · **Status:** Accepted & implemented (branch `claude/sanction-ai-gtm-nhqfzx`)
**Context:** ADR-0007 made `status:"escalated"` reachable. That exposed the #1 reliability risk
(BACKLOG `UX-2`): an escalated request has no resolution path if the owner never acts, so a
polling agent waits forever — a hung agent, possibly mid-task with a held budget.
**Decision:** Add two policy knobs — `escalationTimeoutMins` (default 60; 0 = wait indefinitely)
and `escalationTimeoutAction` (`deny` | `approve`, default **deny** = fail-closed). An escalation
past its deadline is settled to the fallback terminal state **lazily, on the next read** (no cron —
serverless-friendly), via a guarded `updateMany (where status='escalated')` that races safely
against a concurrent owner decision; the loser returns the authoritative row. Surfaced on the agent
poll path (`GET /authorize/{id}`) and the owner queue (`listPendingApprovals` settles-then-drops).
New typed code `ESCALATION_TIMED_OUT` (a timeout-approve returns no code — it is an approval).
**Implementation:** `lib/approvals.ts` (`escalationExpired`, `settleIfExpired`), `app/api/v1/authorize/[id]`,
`lib/decisions.ts` + `lib/openapi.ts`, `lib/policy.ts` (editable via PATCH /wallets/policy), schema +
migration `20260620190000_escalation_timeout` (columns default-backfilled). Tests in `tests/approvals.test.ts`.
**Consequences:** The approve/escalate/deny loop is now terminating and production-safe. Dashboard form
controls for the two knobs are a follow-up (REST/PATCH already accept them). Fail-closed default means a
silent owner denies the charge; owners who want optimism opt into `approve`.

## ADR-0007 ACCEPTED — Spend-ladder semantics + reachable escalation on the default policy
**Date:** 2026-06-20 · **Status:** Accepted & implemented (branch `claude/sanction-ai-gtm-nhqfzx`)
**Context:** Two launch-blocking gaps between the marketed model and the `/authorize` engine.
(1) **Escalation was unreachable on a fresh wallet:** defaults were `perTransactionMaxUsd $50`,
`escalateOverUsd $100`, and the per-txn cap is checked *before* escalation — so any amount large
enough to escalate ($100+) was already denied as `PER_TXN_LIMIT`. `status:"escalated"` — the heart
of the approve/escalate/deny pitch and the public Test Kit (B5) — could never fire out of the box.
(2) **`autoApproveUnderUsd` and `allowedCategories` were sold but unenforced** — neither was read by
`/authorize` (only `blockedCategories`, `perTransactionMaxUsd`, `dailySpendBudgetUsd`, `escalateOverUsd`).
On a governance product, an advertised-but-unenforced control is a trust liability.
**Decision:** Define one explicit ladder and enforce all of it. Within budget and allowed category:
`amount ≤ autoApproveUnderUsd` → approved (silent floor) · `≤ escalateOverUsd` → approved ·
`escalateOverUsd < amount ≤ perTransactionMaxUsd` → escalated · `> perTransactionMaxUsd` → denied.
Invariant `autoApproveUnder ≤ escalateOver < perTransactionMax`. New defaults: autoApprove **$10**,
escalateOver **$25** (was $100), per-txn $50 — so escalation fires in the $25–$50 band. Enforce
`allowedCategories` (non-empty allow-list denies unlisted categories) with a new `CATEGORY_NOT_ALLOWED`
decision code, distinct from `CATEGORY_BLOCKED`.
**Implementation:** `app/api/v1/authorize/route.ts` (allow-list gate + auto-approve floor), `lib/decisions.ts`
+ `lib/openapi.ts` (new code), `prisma/schema.prisma` + migration `20260620180000_policy_escalation_defaults`
(column DEFAULT only — existing Policy rows keep their configured values, no data rewritten). Landing
`/authorize` snippet corrected to the real request/response shape. Test Kit B5/B3b updated. 17 tests pass.
**Consequences:** Escalation is demoable on any new wallet; the Test Kit passes as written; advertised
policy knobs are now truthful. Live wallets (incl. AIIA) are unaffected — defaults apply only to new
Policy rows, and data-plane behavior for already-configured policies is unchanged except that an
allow-list, *if set*, now actually denies unlisted categories (previously a silent no-op).

## ADR-0006 ACCEPTED — Adopt the agent-team planning docs as canonical; consolidate to `docs/`
**Date:** 2026-06-15 · **Status:** Accepted
**Context:** The agent team supplied richer, market-aware `SIGNALS.md` / `BACKLOG.md` / `ROADMAP.md` (cleaner ID scheme: `SEC-/UX-/DIST-/FUND-/POS-/SIG-`; RICE + Gate model; signals my first-pass missed — MCP Registry, Connectors Directory, AgentCore, AP2/x402, prompt-injection moat, custody question). My first-pass used `S-/N-/L-/F-` ids and lived partly at repo root.
**Decision:** Adopt the team's docs as canonical, **reconciled against code** (validated/refuted each "validate against code" flag) and against what shipped in PR #1. Consolidate all four iteration docs under `docs/`; delete the root `ROADMAP.md`/`BACKLOG.md` duplicates to keep one source of truth.
**Finding→new-ID map (for traceability):** THREAT/FINDINGS `F1/F2/F3` (unauth mgmt plane) → **SEC-15** (shipped); `V2a` double-spend → **SEC-4** (shipped); `F5` cred-expiry → shipped (folded into SEC-5/SEC-8 area); `V1` key custody → **SEC-1/SEC-2**; `V2b` isolation → **SEC-3**; `F6` revocation / `F7` asymmetric → **SEC-5/SEC-10**; `F9` committed ids / key rotation → **SEC-6/SEC-16**; audit → **SEC-7**.
**Consequences:** Older docs (`SECURITY-FINDINGS.md`, `SECURITY-THREAT-MODEL.md`, `PRODUCT-OWNERSHIP.md`) still reference `F#/S#` ids; this map keeps them traceable. Future work references the `SEC-/UX-/DIST-` scheme.

## ADR-0005 ⚑ PROPOSED — Wallet rails: control plane vs. fund custody
**Date:** 2026-06-15 · **Status:** Proposed (needs founder decision)
**Context:** Sanction is marketed as an "agent wallet" but today only *authorizes* and *logs* spend; it never moves money (the `stripe` dependency is unused). Two divergent futures: (A) stay an **authorization + audit control plane** that rides existing rails (cards, agent-payment protocols), keeping Sanction out of money-transmission/PCI scope; (B) add **real spend rails** (virtual-card issuing or an agent-payment protocol) and custody/route funds, becoming a true wallet — far larger TAM but heavy compliance (MTL/KYC/PCI).
**Decision:** Deferred to founder. Recommendation: **(A) for now** — it is where the current code already is, keeps regulatory surface minimal, and the differentiated value (scoped credential injection + policy) doesn't require custody. Re-open if a design partner needs custody.
**Consequences:** Narrative shifts from "wallet that holds funds" to "the spend *authorization* and credential layer" until/unless (B) is chosen.

## ADR-0004 ACCEPTED — Authentication model for the management plane
**Date:** 2026-06-15 · **Status:** Accepted & implemented (branch `claude/modest-albattani-620j27`)
**Implementation:** `lib/ownerAuth.ts` (`authenticateOwner`), `sk_` management key issued once by `POST /wallets`, required (`x-mgmt-key`) on `POST/GET /agents`, `POST/GET /credentials/vault`. `GET /wallets/stats` accepts the mgmt key OR a valid agent key of the same wallet (preserves the MCP `sanction_wallet_status` tool). Pre-existing wallets fail closed and are bootstrapped via `POST /wallets/bootstrap-key` (admin-secret-gated). Data-plane endpoints (`/authorize`, `/tokens`, `/exec`, `/inject`) unchanged → no break to the live AIIA integration.
**Context:** `/wallets`, `/agents`, `/credentials/vault`, `/stats` are unauthenticated (THREAT F1–F4); `wallet_id` is non-secret. Agent `pxy_` keys are runtime credentials and must not be able to self-register siblings or manage the wallet.
**Decision:** Split planes. **Management plane** (create/list agents, manage vault & policy, read stats) requires a wallet-owner **management key** (`sk_`-style, issued once at wallet creation) or real user auth. **Data plane** (`/authorize`, `/tokens`, `/exec`, `/inject`) keeps `pxy_` agent-key / Bearer-JWT auth.
**Consequences:** API contract change for management endpoints; the live AIIA integration uses only data-plane endpoints (no break). Enables real multi-tenancy. → BACKLOG S-1.

## ADR-0003 ACCEPTED — Default-deny credential access
**Date:** 2026-06-15 · **Status:** Accepted; **allow-list flip deferred** to a follow-up
**Context:** `CredentialVault.allowedAgentIds` defaults to `[]`, interpreted as "all agents in wallet." Combined with open agent registration, this is the core of the F1 disclosure chain.
**Decision:** Flip semantics to **default-deny**: empty allow-list grants access to *no* agent; access must be explicitly granted.
**Why deferred from the first security PR:** the F1 disclosure chain is already closed by ADR-0004 (an attacker can no longer mint an agent at all). The allow-list flip touches the **data plane** (`/exec`) and would break the live AIIA integration if its credentials were stored with empty allow-lists. It needs a coordinated step: audit existing rows, backfill `allowedAgentIds`, then flip. Tracked in BACKLOG; do **not** flip blind against production.
**Consequences:** Defense-in-depth, not the primary fix; requires a data backfill before the one-line `/exec` change.

## ADR-0002 ACCEPTED — Keep symmetric crypto for MVP, plan envelope encryption
**Date:** 2026-06-15 · **Status:** Accepted
**Context:** Single global HS256 JWT secret and one AES-256-GCM key (`sha256(env)`) for all tenants; no rotation, no KMS (THREAT F7).
**Decision:** Acceptable for MVP/single-tenant. **Plan** envelope encryption with a KMS master key + per-credential `keyId` for rotation (and per-wallet data keys for blast-radius isolation) before onboarding external tenants with real secrets. → BACKLOG L-1.
**Consequences:** Tech debt acknowledged; ciphertext format will need a `keyId` prefix when L-1 lands.

## ADR-0001 ACCEPTED — Two-step scoped credential injection (exec → inject)
**Date:** 2026-06-15 (documenting existing design) · **Status:** Accepted
**Context:** Agents need third-party secrets at runtime without those secrets living in prompts/logs/env.
**Decision:** Issue a short-lived (≤60 min, default 15 min) scoped HS256 JWT via `/exec` (persisted as `ExecutionToken` keyed by `jti`); release a decrypted credential only via `/inject` against a valid in-scope, unexpired, unrevoked token, writing a `CredentialInjection` audit row each time.
**Consequences:** This is Sanction's differentiated core and is well-built. Gaps to close: enforce credential `expiresAt`, enforce per-execution budget, add revocation (F5, F6, F8).
