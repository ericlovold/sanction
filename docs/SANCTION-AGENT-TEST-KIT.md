# Sanction — Agent Test Kit

**You are an AI agent. Your job is to test Sanction end-to-end and report back.**
Sanction is a trust/governance layer for autonomous agents: a wallet, a spend policy, a
credential vault, and an audit log. Before an agent spends money it calls `/authorize`;
Sanction returns **approve / escalate / deny** and logs everything.

You are validating three things:

- **A — Configuration:** Can an agent get itself set up quickly and unambiguously?
- **B — Budget stopping:** Does it *actually* stop spend at the limits? (and how good is the experience?)
- **C — Tracking & variables:** Can you see usage, and can you change the limits easily?

Work through every step. Record the actual response, compare to **Expected**, mark
**PASS/FAIL**, and capture friction. Fill in the **Report** at the bottom and return it.

---

## 0. Environment

**Target API (live):** `https://onesanction.com/api/v1`

```bash
export SANCTION_API="https://onesanction.com/api/v1"
```

> Local alternative: `npm install && npm run dev` → `export SANCTION_API="http://localhost:3000/api/v1"`
> (requires a Postgres `DATABASE_URL`; the build runs `prisma migrate deploy`).

**Three identities you will handle — do not confuse them:**

| Thing | Looks like | Header | Plane | Shown |
|---|---|---|---|---|
| Management key | `sk_…` | `x-mgmt-key` | Owner / management | once, at wallet creation |
| Agent API key | `pxy_…` | `x-api-key` | Data plane (authorize, tokens) | once, at agent registration |
| Execution token | JWT | `Authorization: Bearer` | Credential injection (15-min TTL) | per exec request |

---

## Part A — Configuration (can an agent set itself up?)

### A1. Create a wallet (sign-up, unauthenticated)

```bash
curl -s -X POST "$SANCTION_API/wallets" \
  -H "content-type: application/json" \
  -d '{"name":"test-fleet","owner_email":"you@example.com"}'
```

**Expected:** `201` with `id` (wallet id) and `management_key` (`sk_…`).
**Capture it:**
```bash
export WALLET_ID="<id from response>"
export MGMT_KEY="<management_key from response>"
```
**PASS if:** you got a wallet id and a management key in one call, no prior auth needed.

### A2. Register an agent (management plane)

```bash
curl -s -X POST "$SANCTION_API/agents" \
  -H "content-type: application/json" \
  -H "x-mgmt-key: $MGMT_KEY" \
  -d "{\"wallet_id\":\"$WALLET_ID\",\"name\":\"agent-001\"}"
```

**Expected:** `201` with `api_key` (`pxy_…`), returned once.
```bash
export AGENT_KEY="<api_key from response>"
```
**PASS if:** registration required the management key (try it *without* `x-mgmt-key` → expect `401`) and returned a usable agent key.

### A3. Configure the agent runtime

**Option 1 — MCP (Claude Desktop / any MCP host)** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "sanction": {
      "command": "npx",
      "args": ["sanction-mcp"],
      "env": {
        "SANCTION_API_URL": "https://onesanction.com/api/v1",
        "SANCTION_API_KEY": "pxy_...",
        "SANCTION_WALLET_ID": "wallet_..."
      }
    }
  }
}
```
**Option 2 — REST:** send `x-api-key: $AGENT_KEY` on data-plane calls (below).

**A — Report:** How many minutes from zero to a working agent key? Where did you hesitate?
Were the three key types clear? Did any error message leave you stuck?

---

## Part B — Budget stopping (does it actually stop the money?)

A fresh wallet ships with this **default policy** (all USD):

| Variable | Default | Enforced in `/authorize`? |
|---|---|---|
| `perTransactionMaxUsd` | $50 | ✅ deny over (hard cap) |
| `dailySpendBudgetUsd` | $50 | ✅ deny when day total would exceed |
| `escalateOverUsd` | $25 | ✅ escalate over (reachable: $25 < $50 per-txn — see B5) |
| `autoApproveUnderUsd` | $10 | ✅ at/under → approved silently |
| `dailyTokenBudgetUsd` | $10 | ✅ enforced in `/tokens` |
| `blockedCategories` | gambling, adult, crypto | ✅ hard deny (`CATEGORY_BLOCKED`) |
| `allowedCategories` | software, services, research, infrastructure | ✅ deny when set & category not listed (`CATEGORY_NOT_ALLOWED`) |

The decision ladder (within budget): `≤ $10` approved silently · `$10–$25` approved ·
`$25–$50` **escalated** · `> $50` denied (`PER_TXN_LIMIT`). Categories: blocked → deny;
allow-list set and category not on it → deny.

Run each case with the agent key. Record `status`, `authorized`, `code`, HTTP code.

### B1. Approve — small, allowed
```bash
curl -s -X POST "$SANCTION_API/authorize" -H "x-api-key: $AGENT_KEY" -H "content-type: application/json" \
  -d '{"action":"purchase","amount_usd":12.50,"merchant":"Anthropic","category":"services"}' -w "\nHTTP %{http_code}\n"
```
**Expected:** `200`, `authorized:true`, `status:"approved"`.

### B2. Deny — over per-transaction limit
```bash
curl -s -X POST "$SANCTION_API/authorize" -H "x-api-key: $AGENT_KEY" -H "content-type: application/json" \
  -d '{"action":"purchase","amount_usd":75,"merchant":"AWS","category":"infrastructure"}' -w "\nHTTP %{http_code}\n"
```
**Expected:** `403`, `authorized:false`, `code:"PER_TXN_LIMIT"`, a `remediation` hint.

### B3. Deny — blocked category
```bash
curl -s -X POST "$SANCTION_API/authorize" -H "x-api-key: $AGENT_KEY" -H "content-type: application/json" \
  -d '{"action":"purchase","amount_usd":5,"merchant":"SomeExchange","category":"crypto"}' -w "\nHTTP %{http_code}\n"
```
**Expected:** `403`, `code:"CATEGORY_BLOCKED"`.

### B3b. Deny — category not on the allow-list
A category that is neither blocked nor in `allowedCategories` (which defaults to
software/services/research/infrastructure):
```bash
curl -s -X POST "$SANCTION_API/authorize" -H "x-api-key: $AGENT_KEY" -H "content-type: application/json" \
  -d '{"action":"purchase","amount_usd":5,"merchant":"SomeVendor","category":"consulting"}' -w "\nHTTP %{http_code}\n"
```
**Expected:** `403`, `code:"CATEGORY_NOT_ALLOWED"`. (Empty allow-list = allow all categories.)

### B4. Deny — daily budget exhausted
Approve repeatedly under the per-txn cap until the **day total** would cross $50
(e.g. five $12 charges, then one more).
**Expected:** first calls `approved`; the one that crosses $50 → `403`, `code:"DAILY_BUDGET_EXCEEDED"`.

### B5. Escalation — does it trigger?
Send an amount in the escalation band (`escalateOverUsd` $25 < amount ≤ `perTransactionMaxUsd` $50):
```bash
curl -s -X POST "$SANCTION_API/authorize" -H "x-api-key: $AGENT_KEY" -H "content-type: application/json" \
  -d '{"action":"purchase","amount_usd":30,"merchant":"Bigco","category":"services"}' -w "\nHTTP %{http_code}\n"
```
**Expected:** `200`, `status:"escalated"`, `code:"ESCALATION_REQUIRED"` — the request pauses for
a human (resolve it in B8). A larger amount (e.g. $150) is denied as `PER_TXN_LIMIT` because it
exceeds the $50 hard cap before it can escalate. Confirm both: $30 escalates, $150 denies.

### B6. Idempotency
Repeat B1 twice with the same `Idempotency-Key: test-123` header.
**Expected:** identical decision + same `request_id` both times (no double-spend on retry).

### B7. Token budget stop
```bash
curl -s -X POST "$SANCTION_API/tokens" -H "x-api-key: $AGENT_KEY" -H "content-type: application/json" \
  -d '{"model":"claude-opus-4-8","tokens_in":1000,"tokens_out":2000,"cost_usd":4.00,"task":"test"}' -w "\nHTTP %{http_code}\n"
```
Repeat until daily token cost would exceed **$10**.
**Expected:** logs succeed until the cap; the call that crosses $10 → error `"Daily token budget exceeded"`.

### B8. Approval loop — resolve an escalation
Once a charge is `escalated` (see B5 / set `escalate_over_usd` below `per_transaction_max_usd`):
1. **Agent waits:** poll `GET /authorize/<request_id>` (x-api-key) — status stays `escalated`.
2. **Owner sees it:** `GET /approvals?wallet_id=$WALLET_ID` (x-mgmt-key), or the dashboard **Approvals** tab.
3. **Owner decides:** `POST /approvals {wallet_id, request_id, decision:"approve"|"reject", note}` — or click Approve/Reject.
4. **Agent learns the outcome:** re-poll `GET /authorize/<request_id>` → now `approved` / `denied` with the note.

**Expected:** the agent can poll a stable result; the owner sees the queue; resolving flips the
status once (a second resolve returns `409`).

**B — Report (incl. UX/UI):**
- Did real money-stops fire exactly at the thresholds? Any off-by-one or race?
- Were denials **actionable**? Rate the `code` + `remediation` 1–5 for "could I replan from this without a human?"
- The escalation experience: if a charge escalates, how would a human even see/approve it
  today? What's missing for that loop to feel complete? (This is UX we want to design.)
- If you were the wallet owner watching this, what one screen would you want open?

---

## Part C — Tracking & setting variables

### C1. Read usage (tracking)
```bash
curl -s "$SANCTION_API/wallets/stats?wallet_id=$WALLET_ID" -H "x-mgmt-key: $MGMT_KEY" | json_pp
```
**Expected:** `today` / `month` rollups for token cost and approved spend, recent
authorizations, recent token logs, and a count of pending escalations.
**PASS if:** the numbers match what you actually did in Part B.
Also try with `x-api-key: $AGENT_KEY` instead of the mgmt key (agents may read their own wallet).

### C2. Change a limit (the real test of "simple")
**Lower the per-transaction max to $20 and add `marketing` to blocked categories.** Two ways:

REST:
```bash
curl -s -X PATCH "$SANCTION_API/wallets/policy" -H "x-mgmt-key: $MGMT_KEY" -H "content-type: application/json" \
  -d "{\"wallet_id\":\"$WALLET_ID\",\"per_transaction_max_usd\":20,\"blocked_categories\":[\"crypto\",\"marketing\"]}"
```
Or the **Spend tab → Policy editor** in the dashboard (no key needed when SANCTION_WALLET_ID
is set; saves server-side).
- Document which you used and how many steps it took.
- Bonus: set `escalate_over_usd` **below** `per_transaction_max_usd` (e.g. $15) and confirm a
  charge between them now returns `status:"escalated"` — escalation is unreachable unless this holds.

### C3. Verify the change took effect
If C2 succeeded, re-run B1 against the new limit and confirm the new threshold is enforced.

**C — Report:** Could you see usage clearly? Could you change a variable, and how many steps /
how much guessing did it take? What would make setting budgets/categories a 10-second task?

---

## UX/UI evaluation rubric (rate 1–5, add a sentence each)

1. **Time-to-first-authorized-call** (setup friction)
2. **Decision legibility** — is approve/deny/escalate instantly understandable to an agent *and* a human?
3. **Remediation quality** — can an agent self-correct from a denial without escalating to a person?
4. **Escalation loop** — is there a visible, usable path for a human to approve a paused charge?
5. **Observability** — can the owner answer "what did my agents spend today, and where?" in one glance?
6. **Variable-setting** — how hard is it to change a budget, threshold, or category?

For any dashboard screens you can reach, attach screenshots and note what's missing.

---

## Report — fill this in and return it

```
SANCTION TEST REPORT
Tester (agent/model):
Target API:
Date:

A — CONFIGURATION
  Time to working agent key:
  Steps that caused hesitation:
  PASS/FAIL + notes:

B — BUDGET STOPPING
  B1 approve:           [result] PASS/FAIL
  B2 per-txn deny:      [result] PASS/FAIL
  B3 category deny:     [result] PASS/FAIL
  B4 daily-budget deny: [result] PASS/FAIL
  B5 escalation:        [what actually happened — reachable or not?]
  B6 idempotency:       [result] PASS/FAIL
  B7 token budget stop: [result] PASS/FAIL
  Did money actually stop at the limits? :
  Remediation usefulness (1-5):
  Escalation loop — what's missing:

C — TRACKING & VARIABLES
  C1 stats accurate vs. actual? :
  C2 could you change a limit? how? steps:
  C3 change enforced? :

UX/UI RUBRIC (1-5 each + one line)
  1 setup friction:
  2 decision legibility:
  3 remediation quality:
  4 escalation loop:
  5 observability:
  6 variable-setting:

TOP 3 THINGS TO FIX:
  1.
  2.
  3.
```

---

## Appendix — endpoint reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/wallets` | none | Create wallet → management key |
| POST | `/agents` | `x-mgmt-key` | Register agent → agent key |
| GET | `/agents?wallet_id=` | `x-mgmt-key` | List agents |
| POST | `/authorize` | `x-api-key` | Spend decision (approve/escalate/deny) |
| GET | `/authorize/{id}` | `x-api-key` or `x-mgmt-key` | Poll a request's status (for escalations) |
| GET | `/approvals?wallet_id=` | `x-mgmt-key` | List escalations awaiting a decision |
| POST | `/approvals` | `x-mgmt-key` | Approve or reject an escalated request |
| POST | `/tokens` | `x-api-key` | Log token usage + enforce token budget |
| GET | `/wallets/stats?wallet_id=` | `x-mgmt-key` or `x-api-key` | Usage rollups |
| GET | `/wallets/policy?wallet_id=` | `x-mgmt-key` | Read current policy |
| PATCH | `/wallets/policy` | `x-mgmt-key` | Update budgets / thresholds / categories (dollars) |
| POST | `/wallets/bootstrap-key` | `x-admin-secret` | One-time mgmt-key bootstrap for legacy wallets |
| POST | `/credentials/vault` | `x-mgmt-key` | Store an encrypted credential |
| POST | `/credentials/inject` | `x-api-key` | Get a scoped exec token for a credential |
| POST | `/exec` / `/exec/revoke` | Bearer | Use / revoke a 15-min execution token |

**Decision codes:** `ESCALATION_REQUIRED`, `NO_POLICY`, `CATEGORY_BLOCKED`,
`CATEGORY_NOT_ALLOWED`, `PER_TXN_LIMIT`, `DAILY_BUDGET_EXCEEDED`, `POLICY_DENIED`.
Approvals return no code.
