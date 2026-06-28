# AIIA × Sanction — Dogfood Reference Architecture

> How AIIA (a real autonomous agent on a Mac Mini M4) runs under Sanction governance.
> This is `DIST-3` from the [roadmap](../ROADMAP.md): the reference architecture and OSS
> quickstart, proven by dogfooding before we ask anyone else to trust it.
>
> **Why it matters:** AIIA's existing three-tier execution model (`AUTO` / `SUPERVISED` /
> `GATED`) maps ~1:1 onto Sanction's decision ladder and clearance levels. The dogfood isn't
> a toy integration — it's the canonical example of the governance plane working end-to-end.

---

## The core mapping

AIIA already gates its own actions through three execution strategies
(`local_brain/execution/strategies.py`). Sanction's `/authorize` decision ladder is the same
shape, which is what makes AIIA the natural first client:

| AIIA execution tier | Sanction decision | Clearance intent | What happens |
|---|---|---|---|
| `AUTO` | `approved` (silent, ≤ auto-approve floor) | Low-risk, pre-cleared | Agent proceeds, action logged |
| `SUPERVISED` | `escalated` | Needs a human in the loop | Request pauses; owner approves/rejects |
| `GATED` | `denied` (policy/category/budget) | Blocked or over-budget | Agent does **not** act; gets a remediation hint |

The insight: AIIA was already making approve/escalate/deny decisions *locally* with no audit
trail and no cross-tool policy. Sanction externalizes that decision into a governance plane
that (a) logs every call, (b) lets a human resolve escalations from anywhere, and (c) enforces
one policy across every agent and tool — not just AIIA.

---

## Architecture

```
┌─────────────────────────────── Mac Mini M4 ───────────────────────────────┐
│                                                                            │
│   AIIA Brain (FastAPI :8100)                                               │
│   local_brain/                                                             │
│   ├── execution/strategies.py   AUTO / SUPERVISED / GATED                  │
│   ├── ollama_client.py          local model calls  ──┐                     │
│   ├── mlx_client.py             local model calls  ──┤ token usage         │
│   └── sanction.py  ───────────────────────────────────┐                   │
│                                                        │                   │
└────────────────────────────────────────────────────────┼───────────────────┘
                                                          │
                          POST /tokens   (x-api-key)      │   meter every model call
                          POST /authorize (x-api-key)     │   ask before every spend
                                                          ▼
                              ┌──────────────────────────────────┐
                              │  Sanction  (getsanction.com/api/v1)│
                              │  policy engine · audit · escalation│
                              └──────────────────────────────────┘
                                                          │  escalation.created
                                                          ▼
                                       owner approves/rejects (dashboard or
                                       POST /approvals) — human-in-the-loop
```

Two integration points, both fire-and-aware (governance must never break core AIIA):

1. **Token metering** — every local/remote model call logs usage to `POST /tokens`. Enforces
   the daily token budget. Today: `local_brain/sanction.py` (`log_tokens` / `log_tokens_bg`).
2. **Spend authorization** — before AIIA spends money (subscribing to a tool, paying an API),
   it calls `POST /authorize` and honors approve / escalate / deny.

---

## Quickstart

### 1. Provision a wallet + agent

```bash
export SANCTION_API="https://getsanction.com/api/v1"

# Create a wallet (returns management_key sk_…)
curl -s -X POST "$SANCTION_API/wallets" \
  -H "content-type: application/json" \
  -d '{"name":"aiia-brain","owner_email":"you@example.com"}'

# Register the AIIA agent (returns api_key pxy_…)
curl -s -X POST "$SANCTION_API/agents" \
  -H "content-type: application/json" -H "x-mgmt-key: <sk_…>" \
  -d '{"wallet_id":"<wallet_id>","name":"aiia-brain"}'
```

### 2. Wire it into AIIA's env

`~/aiia-brain/AIIA-public/.env`:

```
SANCTION_API_URL=https://getsanction.com/api/v1
SANCTION_API_KEY=pxy_…          # the agent key from step 1
SANCTION_WALLET_ID=<wallet_id>
```

The client (`local_brain/sanction.py`) no-ops cleanly if these are unset, so AIIA runs fine
ungoverned in dev and picks up governance the moment the env is present.

### 3. Meter model calls

```python
from local_brain.sanction import log_tokens_bg

# after any model call:
log_tokens_bg(model="claude-opus-4-8", tokens_in=tin, tokens_out=tout, task="briefing")
```

### 4. Authorize spend (the part to finish — see "Current state")

```python
status = authorize(amount_usd=19.00, merchant="Anthropic",
                   category="services", why="API top-up")
if status == "approved":
    ...  # AUTO: proceed
elif status == "escalated":
    ...  # SUPERVISED: wait for the owner, poll GET /authorize/{request_id}
else:
    ...  # GATED: do not spend; surface the remediation hint
```

See [`examples/aiia_agent.py`](../../examples/aiia_agent.py) for a runnable end-to-end version.

---

## Default policy (what stops the money)

A fresh wallet ships with this policy. The decision ladder *is* the tier mapping above.

| Variable | Default | Tier it produces |
|---|---|---|
| `autoApproveUnderUsd` | $10 | ≤ → `AUTO` (silent approve) |
| `escalateOverUsd` | $25 | $25–$50 → `SUPERVISED` (escalate) |
| `perTransactionMaxUsd` | $50 | > → `GATED` (`PER_TXN_LIMIT`) |
| `dailySpendBudgetUsd` | $50 | day total over → `GATED` (`DAILY_BUDGET_EXCEEDED`) |
| `dailyTokenBudgetUsd` | $10 | token cost over → `/tokens` rejects |
| `blockedCategories` | gambling, adult, crypto | → `GATED` (`CATEGORY_BLOCKED`) |
| `escalationTimeoutMins` / `…Action` | 60 / deny | unresolved escalation fails closed → terminal state |

Full test matrix: [`docs/SANCTION-AGENT-TEST-KIT.md`](../SANCTION-AGENT-TEST-KIT.md).

---

## Current state vs. target (be honest)

The dogfood is **partially wired**. What's true today and what closes the loop:

| Piece | State | To finish |
|---|---|---|
| Token metering | ✅ live (`sanction.py` → `/tokens`) | — |
| Cost accuracy | ⚠️ **bug**: `sanction.py` applies Sonnet rates ($3/$15 per M) to *all* `claude` models, so Opus usage is under-costed ~5×, and token budgets trip late | Add per-model rates (Opus, Sonnet, Haiku) |
| Branding | ⚠️ `sanction.py` still says "AutoFlux" throughout (works — reads `SANCTION_*` env) | Rebrand to Sanction |
| Spend authorization | ⬜ not wired — AIIA logs usage but doesn't call `/authorize` yet | Add an `authorize()` client + call it before spend; map result → execution tier |
| Tier → clearance | ◑ modeled here; enforcement is roadmap (`NEXT`) | Wire clearance to gate categories/scopes |

When these close, AIIA becomes the citable reference: *a real agent, governed end-to-end, with
a public quickstart anyone can copy.* That's the `DIST-3` deliverable.
