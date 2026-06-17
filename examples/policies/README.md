# Sanction Policy Blueprints

Copyable, opinionated starting policies so builders don't face a blank form. Each
blueprint is a governance pattern for a class of agent, grounded in what the
`/authorize`, `/exec`, and `/credentials/*` endpoints **actually enforce today**
— not aspirational fields.

> **Custody model:** Sanction is a **control plane — it holds no money** (FUND-1
> ratified: no custody). Budgets are *accounting caps* over the agent's own rails
> (model providers, paid APIs, Stripe/Circle/Coinbase if you wire them). Sanction
> *decides, logs, and audits*; it never moves funds.

## Blueprints

| File | For | Daily cap | Per-txn ceiling | Escalate over | Clearance |
|------|-----|-----------|-----------------|---------------|-----------|
| `secure-nightly-coding-agent.json` | Overnight coding/research agent (models, sandboxes, GitHub/Vercel/staging DB) | $50 | $20 | $5 | 3 |
| `safe-research-agent.json` | Read-only research agent (model/data/news vendors, no writes, no prod) | $15 | $5 | $2 | 1 |

## Reference architecture

```
1. Scheduler/Trigger ──► 2. Coding agent (Vercel/container, task loop) ──┐
                                                                          ▼
                                          3. SANCTION CONTROL PLANE  (REST / MCP / Bedrock)
                                          ├─ Authorize : budgets, thresholds, allow/block, approve/escalate/deny
                                          ├─ Protect   : encrypted vault + 15-min execution JWTs
                                          ├─ Govern    : clearance 1–5, domain-scoped access
                                          └─ Audit     : decision log, spend trace, secret-access log
                                                  │            │              │
                                          Model providers   Secret-backed   Spend rails
                                          (Anthropic/        tools          (paid APIs,
                                           Gemini/Mistral)   (GitHub/        Stripe/Circle/
                                                             Vercel/DB)      Coinbase)
                                                  │
                                          4. Human escalation + morning review
                                             (Slack/email approval + dashboard)
```

The agent runs under a scoped `pxy_` identity (one agent → one wallet → one
policy). Before each costly or sensitive action it calls Sanction; on **approve**
it proceeds (requesting a short-lived execution token to inject a credential when
needed), on **escalate** it pauses for a human, on **deny** the tool call never
runs. Every decision becomes the audit trail and the morning dashboard.

## How the numbers map to the real policy engine

All policy amounts are **integer cents** (matches `prisma/schema.prisma` →
`model Policy`). The `/authorize` decision order (see `app/api/v1/authorize/route.ts`):

1. **No policy** → `denied`.
2. `category` in `blockedCategories` → `denied`.
3. `amount > perTransactionMaxUsd` → `denied`.
4. (atomic) daily approved spend + amount > `dailySpendBudgetUsd` → `denied`.
5. `amount > escalateOverUsd` → `escalated` (pauses for a human).
6. otherwise → `approved`.

So the ceiling for escalation to be reachable is `escalateOverUsd < perTransactionMaxUsd`.
"Auto-approve ≤ $5, escalate $5–$20, deny > $20" maps to
`escalateOverUsd: 500`, `perTransactionMaxUsd: 2000`.

### Honest enforcement status (read before relying on a field)

| Field / concept | Today |
|---|---|
| `blockedCategories`, `perTransactionMaxUsd`, `dailySpendBudgetUsd`, `escalateOverUsd` | ✅ **Enforced** (daily cap is atomic, SEC-4) |
| Vault scopes + 15-min execution JWT + injection audit | ✅ **Enforced** |
| `allowedCategories` | ⚠️ **Not enforced** — `/authorize` only checks the *blocklist*. Treat the allowlist as documentation of intent until policy-as-allowlist lands (UX-3). |
| `autoApproveUnderUsd` | ⚠️ **Not wired** — present in schema; anything within budget and ≤ `escalateOverUsd` is auto-approved. |
| `clearance` (level/industry/restrictions) | ⚠️ **Modeled only** — `AgentClearance` exists but does not yet gate scopes/categories, and there is no assignment endpoint. Roadmap NEXT: "wire it, then lead with it." |

> Category blocking is an **exact string match** on the `category` your agent
> sends to `/authorize`. Tag spend with the categories in these blueprints
> (`software`, `research`, `infrastructure`, …) for the rules to bite.

## Applying a blueprint

There is **no policy-management API yet** — `POST /v1/wallets` creates a Policy
row from schema defaults only. Until a `PATCH /v1/wallets/:id/policy` endpoint
ships (tracked as UX-3), apply a blueprint by writing the `policy` block to the
Policy row directly.

```bash
# 1. Create a wallet (returns a one-time sk_ management key — store it)
curl -sX POST https://proxy-ai-three.vercel.app/api/v1/wallets \
  -H 'content-type: application/json' \
  -d '{"name":"nightly-coding","owner_email":"you@example.com"}'

# 2. Register an agent under that wallet (needs x-mgmt-key: sk_...)
curl -sX POST https://proxy-ai-three.vercel.app/api/v1/agents \
  -H 'content-type: application/json' -H 'x-mgmt-key: sk_...' \
  -d '{"name":"nightly-coder"}'   # returns the pxy_ key (store it)

# 3. Apply the blueprint's "policy" block to the wallet's Policy row
#    (until PATCH /policy lands, set the cents fields directly).

# 4. From the agent, gate every spend before it happens:
curl -sX POST https://proxy-ai-three.vercel.app/api/v1/authorize \
  -H 'content-type: application/json' -H 'x-api-key: pxy_...' \
  -H 'idempotency-key: job-42-step-3' \
  -d '{"action":"purchase","amount_usd":3.50,"merchant":"anthropic","category":"software","description":"claude tokens for backlog task #42"}'
# → { "authorized": true, "status": "approved", "code": null, ... }
```

## Roadmap hooks

These blueprints are the concrete form of **UX-3 (policy templates)** and feed
**DIST-3 (OSS quickstart)**. The gaps flagged above are the work that makes them
fully real: enforce `allowedCategories`, wire `autoApproveUnderUsd`, and enforce
clearance + add an assignment endpoint. See `docs/ROADMAP.md` / `docs/BACKLOG.md`.
