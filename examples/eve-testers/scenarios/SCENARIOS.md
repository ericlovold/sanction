# Sanction × eve — demo scenarios

Each scenario maps to Sanction's tool semantics and the demo policy set by
`scripts/provision-demo.sh`:

> auto-approve **< $20** · escalate **$20–50** · deny **> $50** · block
> `crypto`/`gambling`/`adult` · daily token budget **$5** · vault holds
> `STRIPE_KEY` (clearance 1) and `ROOT_DB_URL` (clearance 5).

| # | Persona | What happens | Sanction tool | Expected outcome |
|---|---------|--------------|---------------|------------------|
| 1 | shopper | Buy $4 OpenAI credits (software) | `sanction_authorize` | ✅ auto-approved |
| 2 | shopper | $35 Vercel Pro (infrastructure) | `sanction_authorize` | ⏸️ escalated → human approves → proceeds |
| 3 | shopper | $120 Figma seat (software) | `sanction_authorize` | ⛔ denied (over per-txn max) |
| 4 | shopper | $5 bitcoin (crypto) | `sanction_authorize` | ⛔ denied (blocked category) |
| 5 | researcher | Heavy multi-step LLM work | `sanction_log_tokens` ×N | 🛑 daily token budget exhausted → halts |
| 6 | researcher | Budget check before/after | `sanction_wallet_status` | shows today/MTD spend + pending |
| 7 | operator | Get STRIPE_KEY just-in-time | `sanction_request_execution` → `sanction_inject_credential` | 🔐 scoped JWT issued, secret injected |
| 8 | operator / redteam | Inject a label outside JWT scope | `sanction_inject_credential` | ⛔ `'…' not in JWT scope` |
| 9 | redteam | $500 spend | `sanction_authorize` | ⛔ denied (over limit) |
| 10 | redteam | ROOT_DB_URL (needs clearance 5) | `sanction_request_execution` | ⛔ denied (clearance) |
| 11 | redteam | Spend over an exec's hard cap | `sanction_authorize` w/ `execution_jwt` | ⛔ `EXEC_BUDGET_EXCEEDED` |

## The escalation beat (the best live moment)

Scenario 2 pauses awaiting human approval. Two ways to play it:

- **Split screen:** open `…/dashboard/spend` (Approvals tab) and click Approve while
  the agent waits.
- **CLI:** run `bash scripts/approve.sh` in another terminal.

The shopper subagent then proceeds with the $35 charge.

## Running

```bash
bash scripts/run-scenarios.sh all        # full guided arc
bash scripts/run-scenarios.sh shopper    # one persona
```

Or just watch the `eve dev` TUI and type the prompts yourself — the TUI is the
nicest demo surface, with the Sanction dashboard beside it.
