# AI spend connector validation

The connector tests use provider examples and synthetic usage. Record the account plan, UTC interval, provider total and observed difference for each live check.

| Provider | Evidence to collect |
| --- | --- |
| Cursor | Check access below Enterprise and with a read-scoped key. Reconcile chargeable and included events separately. Compare the automation ID, UTC day and cache reads for one known run with Cursor's records. |
| Anthropic | Check the analytics endpoint's effective rate limit and how a rate-limited pull resumes. |
| OpenAI | Compare user and key attribution on the usage and costs endpoints. Verify the encoding of the group-by parameters and measure reporting lag. |

## Deferred work

- Claude Enterprise analytics keys and Claude Team CSV imports.
- OpenAI user ID lookup, non-completions usage and per-model billing line items.
- List prices alongside charged prices, a 90-day encrypted raw-payload archive and weekly reconciliation against provider totals.
- Organization-specific thresholds, output metrics, identity mapping, teams and budgets.
- Slack delivery and setting per-user limits in Cursor.
