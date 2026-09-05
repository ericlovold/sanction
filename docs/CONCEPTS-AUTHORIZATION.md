# Authorization: the decision

Everything in Sanction reduces to one question, asked before an agent acts:
**may this identity do this thing, right now, under this policy, given this
state?** This page is the mental model behind that question. If you want the
one-diagram version first, read [How Sanction works](/architecture).

## The cast

- **Wallet** — the budget container and ownership root. Wallets nest into a
  tree (org → team → seat is just wallets inside wallets).
- **Agent** — a runtime identity under a wallet: a seat you can hand to
  whoever holds it. Its `pxy_` key is the credential the data plane sees.
- **Policy** — one per wallet: the spend ladder, category and tool lists,
  capability rules, escalation behavior. Stored in cents; spoken in dollars.
- **Authorization Request** — one decision request, persisted. Idempotent:
  a retried request replays the original decision instead of double-charging.
- **Grant** — ephemeral authority minted from a human approval. Single-use,
  expiring, bound to what escalated.

Identity itself stays upstream. Sanction consumes canonical identity (your
IdP, SPIFFE, agent cards, plain keys) and mints governed runtime identity —
it is never an identity of record. See [Why Sanction](/why) for why that
separation is deliberate.

## The lifecycle

```text
Authorization Request
      │
  No policy? ──────────────────────────► DENIED   (default deny — fail closed)
      │
  The ladder:
    amount ≤ auto-approve floor ........ APPROVED (silent)
    inside the normal band ............. APPROVED
    over the escalation line ........... ESCALATED → a human
    over the per-transaction max ....... DENIED   (hard cap)
      │
 APPROVED            ESCALATED                    DENIED
    │                    │                           │
 execute        Pending Approval               answers back
                (dashboard / email / Slack)
                         │ approve
                  Grant minted — one use, expiring
                         │
                agent retries with grant_id
                         │
                  Grant consumed → APPROVED → execute
```

Three invariants make this trustworthy:

1. **Fail closed.** No policy means deny. Unresolved escalations settle to
   the policy's timeout action — there are no deadlocks and no silent allows.
2. **Atomic.** The budget check and the debit happen in one evaluation, under
   a lock. Two sibling agents cannot race past a shared cap in the gap
   between "checked" and "charged" — there is no gap.
3. **Grants, not standing permission.** A human's yes mints exactly one
   authorization. The agent redeems it once; the authority dies with the use.

## Budgets

Budgets are policy like everything else: a per-transaction hard cap, daily
and monthly spend budgets, and daily token budgets metered through the LLM
gateway. Because wallets nest, a parent can set a **subtree cap** — a daily
ceiling for everything below it, enforced atomically across all descendants.

## Denials answer back

A Sanction denial is not a dead end. Every denial carries a machine code
(`DAILY_BUDGET_EXCEEDED`, `PER_TXN_LIMIT`, …), the fired limit with live
values (limit, used, remaining, requested), when the answer changes
(`resets_at`), and links to the decision record and its evidence. Hard
budget denials also carry a signed **access request offer** — the agent can
appeal to a human instead of waiting for midnight.

## Where to go next

- [Evidence & replay](/docs/evidence-and-replay) — why every decision can
  prove itself.
- [Capability governance](/docs/capability-governance) — the same engine,
  pointed at new powers instead of money.
- [Quickstart](/docs/quickstart) — make your first governed call.


## Tool approvals bind the request

A new tool approval covers the tool, server, and complete arguments object.
Changing a deployment target, revision, or any other argument requires fresh
approval. JSON object key order is ignored; array order and value types matter.
Omitted arguments mean an empty object. The legacy SDK `input` field is an
alias; sending both fields is rejected. Tool rules still evaluate the tool name,
not argument contents; this binding applies to human-approved exceptions.

The request snapshot is encrypted with the wallet's envelope key. In Approvals,
an admin selects **Review exact request** to decrypt it. Arguments are excluded
from notification bodies and audit exports; the encrypted binding stays on the
approval and grant. Treat the reviewed request as sensitive. Requests are limited to 64 KiB
and 32 nesting levels.

Retry with the one-use `grant_id` (broker: `_meta["sanction/grant_id"]`). An
idempotent replay reports `approval_status` but never authorizes a new attempt;
a replay of an approved request returns `authorized: false`, `status: denied`.
Existing tool grants without a bound snapshot fail closed: request a new
escalation with a fresh idempotency key. Spend and capability grants are unchanged.
AuthZEN/AARP tool requests do not carry arguments; use the native
tool route or broker for argument-bound actions.

A consumed grant authorizes one attempt, not proof of completion. If broker
forwarding fails, `TOOL_EXECUTION_OUTCOME_UNKNOWN` means to check the target
system before requesting another attempt. Sanction does not retry the tool or
restore its consumed grant. Upstream resources can change independently; binding
a request does not freeze their state or provide exactly-once execution.
