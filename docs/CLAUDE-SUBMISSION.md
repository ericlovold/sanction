# Claude connector reviewer packet

Prepared 2026-10-03. Draft for review; no submission or dedicated reviewer-account readiness is claimed. Use with the [distribution checklist](MARKETPLACE-SUBMISSION.md) and [OAuth implementation/evidence notes](MCP-OAUTH.md).

## Listing copy

**Name:** Sanction

**One-liner:** Request human approval for AI agent actions, check budgets, and record usage with Sanction.

**Description:** Sanction gives AI agents an approval and budget checkpoint. Connect an agent in a wallet you administer to request authorization for proposed spending, resource provisioning, tool use or capability acquisition. Ask for a one-off human decision, pause for the owner, then redeem the single-use grant for the original request. You can also inspect budget status and record usage and outcomes. Sanction records decisions; this connector does not transfer funds, provision resources, install software or execute the proposed action. It cannot retrieve vault credentials or issue execution tokens. The host must call Sanction before acting; connecting does not automatically intercept other tools.

**Prerequisites:** A Sanction wallet, an active agent, and a verified social sign-in with owner/admin access to that wallet. Management-key login alone is insufficient for OAuth consent.

**Use cases:** Review a proposed agent action; check budget headroom; record synthetic usage/outcomes during evaluation. Production logging should reflect actual usage and confirmed outcomes.

**Connection:** `https://getsanction.com/mcp/approvals` — remote MCP, OAuth authorization code with S256 PKCE and dynamic client registration. The access scope is `sanction:approvals`; refresh uses `offline_access`.

**Links:** [Website](https://getsanction.com), [setup documentation](https://getsanction.com/docs/connect), [privacy](https://getsanction.com/privacy), [support](https://getsanction.com/support), [manage/disconnect connections](https://getsanction.com/connect/mcp).

**Assets and portal-only fields:** Candidate icon: [logo.svg](../cursor-plugin/assets/logo.svg). Confirm the portal's accepted format before upload. Categories, permanent slug, publisher/company identity, private review contact and final data-handling declarations: **PENDING owner review**. Do not invent category labels or publish credentials in this packet.

## Reviewer setup

1. Prepare a dedicated, populated review wallet and active agent. Confirm the reviewer's social sign-in, wallet permissions, consent and owner-decision access work from a fresh session. Deliver credentials and private instructions only through the review portal.
2. Use synthetic data only. Authorizations, logs, counters, grants and owner notifications are real Sanction writes even when the proposed target is fictional. Keep the wallet separate from production reporting and route notifications only to the review participants.
3. Record the fixture policy before testing: enforce mode, no conflicting block/allow lists, available budget above $0.02, and sufficient token budget. The first two monetary cases below expect policy allowance. Prepare separate explicit blocked-tool, observe-mode and expired-grant cases without changing unrelated wallets.
4. Add the URL as a Claude custom connector, complete OAuth, select the review agent and confirm exactly eight tools. Refresh the tools list if reusing a connection. Also exercise every tool through MCP Inspector; record each surface separately.
5. Prepend this instruction to each host test: **This is a synthetic connector test. Call only the specified Sanction tool. Never purchase, transfer funds, provision, install or invoke the proposed target. Do not poll, retry or create replacement requests automatically.**

## Eight-tool test matrix

All rows are **PENDING in both Claude and MCP Inspector**. Inputs below are fixtures, not observed results. Replace `RUN` with a fresh run label and `REQUEST_ID` only with the actual request returned by the tool-approval case. Save exact original inputs privately for redemption.

| Tool | Synthetic input | Expected result and Sanction side effects |
| --- | --- | --- |
| `sanction_wallet_status` | `{}` | Scoped budget/pending counts; no authorization or metering write. Authentication bookkeeping may occur. |
| `sanction_authorize` | `{"action":"purchase","amount_usd":0.01,"merchant":"review-fixture","category":"other","description":"Synthetic RUN; never purchase"}` | With the prepared allowing policy, `authorized:true`, `next_action:proceed`; authorization/ledger and budget state change. No payment occurs. |
| `sanction_authorize_provision` | `{"resource":"review.fixture","line_item":"Synthetic seat","quantity":1,"unit_price_usd":0.01,"amount_usd":0.01,"category":"other","description":"Synthetic RUN; never provision"}` | With the prepared allowing policy, authorization succeeds and monetary accounting changes. No resource is provisioned. |
| `sanction_authorize_tool` | `{"tool":"demo.noop","server":"review-fixture","arguments":{"message":"Synthetic RUN"},"require_approval":true,"approval_reason":"Synthetic reviewer approval; never execute"}` | `authorized:false`, `next_action:wait`, request ID; pending approval/audit state and configured notifications. Pause for a real reviewer decision. |
| `sanction_authorize_capability` | `{"capability":"skill:review-fixture","arguments":{"purpose":"Synthetic RUN; never install"}}` | With the prepared allowing policy, authorization succeeds and the decision is recorded. No capability is acquired. |
| `sanction_log_tokens` | `{"model":"review-fixture","tokens_in":1,"tokens_out":1,"cost_usd":0,"task":"Synthetic RUN"}` | Records labeled synthetic token usage with zero dollar cost. May exercise budget/notification logic; does not call a model. Never present this as real inference usage. |
| `sanction_log_outcome` | `{"kind":"review-fixture","value_usd":0,"play":"Synthetic RUN","dedupe_key":"review-RUN"}` | Creates one synthetic outcome; repeating the same key deduplicates. Can affect outcome reporting/governance if policy uses this kind. No customer event is created elsewhere. |
| `sanction_check_authorization` | `{"request_id":"REQUEST_ID"}` | Check once while pending: `authorized:false`, `next_action:wait`. After human approval and explicit resume, check once: `authorized:false`, `next_action:retry_with_grant` and active grant. Polling can settle expired approvals under policy, so it is not read-only. |

After approval, retry the **saved tool-authorization input** with its returned `grant_id`. Expect successful redemption, then stop without invoking `demo.noop`. `isError:false` alone never grants permission. Rejecting a separate request must yield `stop`; do not replace it automatically.

Additional pending host checks: changed arguments refused; consumed-grant replay refused; expired authority refused; hard-blocked tool denied despite `require_approval:true`; explicit approval still waits in observe mode; unauthenticated access refused; fresh sign-in/consent; refresh demonstrated by an actual refresh exchange; disconnect followed by denied resource access. Record the applicable policy and actual result rather than treating an unexpected response as a pass. The explicit one-off approval must never auto-approve on timeout.

## Evidence record

2026-10-03: the existing Claude custom connection completed one `sanction_wallet_status` call; the expanded tool response contained normal status data, and Claude reported the expected eight available tools. The signed-in directory portal showed zero submissions. This read-only smoke used the existing connection, not the dedicated review fixture, and does not validate this branch’s metadata before deployment.

2026-10-03 follow-up (operator-supplied Claude results): seven distinct tools were exercised on a dedicated agent in an existing wallet. Wallet status, tool escalation, pending/approved status checks, exact-request grant redemption, consumed-grant rejection, spend/provision authorization and zero-cost token logging returned results. The replay left zero pending approvals. No external tool invocation, purchase, provisioning or model call was performed. These are host observations, not proof of all negative cases or of the changes in this PR being deployed. The live policy page showed zero capability rules; this explains the permissive capability result. Policy was not changed.

Outcome logging was deliberately not invoked: it records business results, not execution receipts. Complete that row in a disposable reviewer wallet with no cost-per-outcome ceiling, using a synthetic kind and unique dedupe key; repeat the key to verify one record. A separate agent inside a shared wallet does not isolate outcome counters. Keep the self-tested attestation incomplete until this tool has actually run. Do not interpret an unreported authorization as proof of non-execution.

Response fixes prepared from this pass: persist fresh capability policy decisions; retain action-specific status-check codes and existing timestamps; return structured token/outcome record IDs. MCP success codes distinguish `AUTHORIZED`, `GRANT_ISSUED` and `GRANT_CONSUMED`; `authorized` and `next_action` remain the execution controls. These are source changes awaiting merge/deployment and host retest, not evidence of a passing live scan.

The directory form reported “Draft saved in this tab.” Reopening the form after its tab was closed showed blank listing fields; the listing copy and links were restored. Keep a local submission packet and do not assume a closed tab preserves company/compliance answers. Entry point: <https://claude.ai/directory/manage/new/connector>. No submission has been made.

For each matrix row and additional check, retain: **host/version; date; deployed revision; fixture policy; sanitized input/result; observed writes; pass/fail; evidence location**. The observations above are partial evidence; the complete matrix and deployed revision remain **PENDING**. Keep tokens, keys, credentials and usable grants out of public captures. A local backend harness or historical smoke does not complete this host matrix.

Reviewer identity readiness, fresh login, populated fixture access, owner-decision instructions, private credential delivery and access expiry: **PENDING**. Do not assume an automatically created wallet supplies a portal-ready reviewer account.

## Account-only submission gates

Use [Claude directory management](https://claude.ai/directory/manage) from the intended owning account. Confirm eligibility, finalize listing/company/contact fields, privately supply reviewer access, and complete compliance acknowledgments. Confirm current privacy/support availability and approve data-retention disclosures. Treat submission as potential publication: connectors may be listed as Community after automated checks. A Community listing is not Verified status. Record the actual submission and listing URLs only after observation. [Submission requirements](https://claude.com/docs/connectors/building/submission)

Before submission, compare the live tool catalog with Claude's requirements for titles, read/write annotations, narrow descriptions, input errors and first-party API use. Resolve any annotation or behavioral-instruction findings; source-code preparation is not a successful portal scan. Demonstrate every tool in Inspector and Claude, and explain that Sanction authorizes proposals without transferring assets. [Review criteria](https://claude.com/docs/connectors/building/review-criteria)

This packet prepares a remote connector. A future skills bundle requires its own Claude-compatible package and separate submission; no plugin-bundle acceptance is implied.
