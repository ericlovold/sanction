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

Fresh evaluations **never** debit a budget, persist a request, or open an
approval — the same contract as `?simulate=true` on the native endpoints.
That makes them safe for PEPs that pre-flight aggressively (an MCP gateway
checking every tool in a manifest, a planner scoring branches). The one
deliberate exception is redeeming an approval, below.

## The approval loop (AARP)

Sanction also implements the AuthZEN **Access Request and Approval Profile**
(draft 1) — the standards path for the loop Sanction runs natively: a denial
you can appeal, a human who decides, a time-boxed approval you present back.

1. **Requestable denial.** When an evaluation would escalate, the
   `decision:false` context carries an `access_request` object: the endpoint
   that opens the real approval, an expiry, and a signed `binding_token`
   proving the denial happened here.

2. **Open the request.** `POST /access/v1/access-request` with the same
   subject/action/resource plus `denial.binding_token`. This persists a real
   Sanction escalation — it lands in the owner's approval inbox and notifies
   via email/Slack/webhooks like any native escalation. You get back a
   `task` with a `status_endpoint`. A mismatched or tampered token is a 400
   problem+json; an expired one is a 410.

3. **Poll the task.** `GET /access/v1/access-request/{id}` until the status
   is terminal: `approved`, `denied`, or `expired`. Approval carries
   `result.mode: "reevaluate"` and the `approval` object — `approval.id` is
   the one-use grant, `approved_until` its expiry, and `approval.status`
   its live state (`active` until redeemed; a consumed grant stays visible
   but is spent).

4. **Redeem by re-evaluating.** POST the same tuple to
   `/access/v1/evaluation` with `context.approval: { id }`. Sanction
   consumes the grant atomically (one use, exactly the native semantics) and
   answers `decision:true`. A second redemption denies with
   `aarp_reason: "approval_expired"` and `next_action: "request"` so your
   PEP knows to open a fresh request.

Discovery: `GET /.well-known/authzen-configuration` names all four endpoints
and advertises `urn:openid:authzen:capability:access-request`.

Not implemented from the draft (deliberately, while it stabilizes):
callbacks (register a [notification route](NOTIFICATIONS.md) instead — same
events, signed), request catalogs and form schemas, and bulk `items[]`.

## Wire details

- `X-Request-ID` from the request is echoed on every response.
- Malformed requests are HTTP 400 (a batch fails whole, naming the bad
  item's index); a missing or invalid key is 401; a subject other than the
  authenticated agent is 403 on the access-request endpoint. The AARP
  binding and task errors specifically (tampered/mismatched token, expired
  denial, unknown task) are RFC 9457 problem+json with the profile's URNs.
- Retrying `POST /access/v1/access-request` with the same `Idempotency-Key`
  returns HTTP 200 with the existing task at its current status.
- Full schemas: [`/api/openapi.json`](https://getsanction.com/api/openapi.json).
