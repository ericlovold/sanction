# Sanction examples — test it with a real agent

A zero-dependency Gemini agent that meters its model calls through Sanction's
token budget and asks Sanction before spending money.

## Quickstart (2 minutes)

```bash
# 1. Create a wallet + agent and load the env (uses the live API by default)
source <(bash examples/setup.sh)

# 2. Make sure your Gemini key is set
export GOOGLE_API_KEY="..."        # you already have this in your shell

# 3. Run the agent
python3 examples/gemini_agent.py
```

You'll see real Gemini calls logged as token usage, then three spend attempts:
`$8` approved, `$45` escalated (waits for a human), `$5` crypto denied.

## Approving the escalation

`setup.sh` prints your `wallet_id` and `management_key`. While the agent waits:

```bash
curl -s "$SANCTION_API_URL/approvals?wallet_id=<wallet_id>" -H "x-mgmt-key: <management_key>"
curl -s -X POST "$SANCTION_API_URL/approvals" -H "x-mgmt-key: <management_key>" \
  -H "content-type: application/json" \
  -d '{"wallet_id":"<wallet_id>","request_id":"<id>","decision":"approve"}'
```

The agent polls `GET /authorize/<request_id>` and proceeds once you decide.

## Per-agent budgets

Give one agent a tighter leash than the wallet default:

```bash
curl -s -X PATCH "$SANCTION_API_URL/agents" -H "x-mgmt-key: <management_key>" \
  -H "content-type: application/json" \
  -d '{"wallet_id":"<wallet_id>","agent_id":"<agent_id>","per_transaction_max_usd":10,"daily_token_budget_usd":2}'
```

Send `null` for any field to clear it (inherit the wallet policy again).

## Knobs

| Env | Default | Notes |
|-----|---------|-------|
| `SANCTION_API_URL` | `https://onesanction.com/api/v1` | point at local `npm run dev` if you prefer |
| `SANCTION_API_KEY` | — | agent key (`pxy_…`), from `setup.sh` |
| `GOOGLE_API_KEY` | — | your Gemini key |
| `GEMINI_MODEL` | `gemini-flash-latest` | any generateContent model |
| `SANCTION_POLL_TRIES` | `30` | escalation poll attempts (2s each) |
