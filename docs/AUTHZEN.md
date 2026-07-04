# Sanction as an AuthZEN PDP

Sanction implements the [OpenID AuthZEN Authorization API 1.0](https://openid.net/specs/authorization-api-1_0.html)
— the approved standard for the question every enforcement point asks a
decision point: *may this happen?* If your gateway, framework, or sidecar
speaks AuthZEN, you can point it at Sanction as its PDP (Policy Decision
Point) with no Sanction-specific code.

**PDP base URL:** `https://getsanction.com/api`
**Auth:** the agent's data-plane key, `x-api-key: pxy_...` — the PDP answers
for the agent that key belongs to.

## One evaluation

```bash
curl -s https://getsanction.com/api/access/v1/evaluation \
  -H "x-api-key: pxy_..." \
  -H "content-type: application/json" \
  -d '{
    "subject":  { "type": "agent", "id": "nightly-coder" },
    "action":   { "name": "invoke" },
    "resource": { "type": "tool", "id": "github.merge_pr" }
  }'
```

```json
{
  "decision": false,
  "context": {
    "code": "TOOL_ESCALATION_REQUIRED",
    "reason": "Tool 'github.merge_pr' requires human approval",
    "remediation": "This tool requires human approval. Poll for status, or wait for the owner to approve. Evaluation is decision-only — POST the invocation to /api/v1/authorize/tool to open the approval and receive a grant."
  }
}
```

Per the spec, **a deny is a successful evaluation**: HTTP 200 with
`decision: false`. Sanction's `context` carries the same stable machine
codes as the native API (`TOOL_BLOCKED`, `PER_TXN_LIMIT`,
`DAILY_BUDGET_EXCEEDED`, `ESCALATION_REQUIRED`, …) plus a remediation hint,
so an agent replans instead of guessing at a bare `false`.

## What `resource.type` selects

| `resource.type` | `resource.id` | Required properties | Evaluated by |
|---|---|---|---|
| `tool` | the tool name | — (optional `server`) | tool block / allow / escalate lists |
| `spend` | the merchant | `amount_usd` (optional `category`) | the spend ladder: floor, escalation band, per-transaction cap, daily + monthly budgets, subtree caps |
| `provision` | the resource (e.g. `azure:seat`) | `amount_usd` (optional `category`, `quantity`, `unit_price_usd`, `line_item`) | resource lists + the spend ladder |

`spend` and `provision` read **live budget state** — the same daily/monthly
aggregates and cascading caps the native `/v1/authorize` endpoints enforce.
Properties may sit on the `resource` or the `action`; action properties win.
`subject.id` must be the authenticated agent's id or name — asking about any
other subject fails closed with `SUBJECT_MISMATCH`.

## Batch

```bash
curl -s https://getsanction.com/api/access/v1/evaluations \
  -H "x-api-key: pxy_..." \
  -H "content-type: application/json" \
  -d '{
    "subject": { "type": "agent", "id": "nightly-coder" },
    "action":  { "name": "invoke" },
    "evaluations": [
      { "resource": { "type": "tool", "id": "search" } },
      { "resource": { "type": "tool", "id": "shell.exec" } },
      { "resource": { "type": "spend", "id": "github",
                      "properties": { "amount_usd": 12, "category": "software" } } }
    ],
    "options": { "evaluations_semantic": "deny_on_first_deny" }
  }'
```

Top-level `subject`/`action`/`resource` are defaults each item overrides.
All three spec semantics are supported: `execute_all` (default),
`deny_on_first_deny`, and `permit_on_first_permit` — the short-circuiting
forms return results up to and including the deciding item. Up to 50 items
per request.

## Decision-only, by design

Evaluation **never** debits a budget, persists a request, or opens an
approval — the same contract as `?simulate=true` on the native endpoints.
That makes it safe for PEPs that pre-flight aggressively (an MCP gateway
checking every tool in a manifest, a planner scoring branches).

When you want the full loop — the escalation that lands in a human's inbox,
the approval that mints a one-use grant, the atomic budget debit — use the
native endpoints the remediation text points to: `POST /api/v1/authorize`,
`/authorize/tool`, `/authorize/provision`. The AuthZEN access-request-and-
approval profile (AARP), which standardizes exactly that loop, is on our
roadmap as the profile finalizes.

## Wire details

- `X-Request-ID` from the request is echoed on every response.
- Malformed requests are HTTP 400 (a batch fails whole, naming the bad
  item's index); a missing or invalid key is 401.
- Full schemas: [`/api/openapi.json`](https://getsanction.com/api/openapi.json).
