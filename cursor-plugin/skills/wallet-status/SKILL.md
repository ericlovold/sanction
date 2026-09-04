---
name: wallet-status
description: Use this at the start of long or expensive agentic work, or after a budget error from authorize or log_tokens. Call sanction_wallet_status to check spend and token headroom before continuing.
---

# Wallet status

The wallet is cooperative: status is a check, not a lock. Call it before expensive work so you stop on empty budget instead of discovering it mid-flight.

## Steps

1. Call `sanction_wallet_status` (no arguments). The wallet is derived from the agent key — do not hardcode a wallet id.
2. Read today's and month-to-date spend and token totals, plus pending approvals.
3. If a horizon is exhausted, stop expensive LLM calls and spend. Notify the owner; do not proceed hoping the next call will pass.
4. After a budget error from `sanction_authorize`, `sanction_authorize_provision`, or `sanction_log_tokens`, call this again, then stop or wait — do not retry the expensive action until headroom exists.

Prefer the Sanction LLM gateway for model calls when available; `sanction_log_tokens` is the honest client-side meter when you cannot.
