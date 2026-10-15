# SANCTION-S1: Grok Bot connector

**Sprint:** Grok Bot connector — Outcome: a Grok Bot user connects Sanction's hosted `/mcp/approvals` server as a connector and completes one real escalated approval end to end (request, human decision in the dashboard, single check, grant redeemed or stopped) with no hand-edited config.

**This file is a spike plan, not evidence.** It does not claim Grok Bot compatibility, a Grok Bot listing, or a completed lifecycle. Consumer Grok, Grok Build, Cursor IDE, and Claude are different hosts.

Prepared 2026-10-15 against `main` at `fd3fefd` (#378). Official Grok Bot docs re-fetched the same day.

## Scope

Prove one **demoable** path on **Grok Bot** (the xAI desktop assistant: [computer and apps](https://docs.x.ai/grok-bot/computer-and-apps)):

1. Add `https://getsanction.com/mcp/approvals` as a connector from the Bot (UI or in-chat), with **OAuth**. No `mcp.json`, env files, or other hand-edited host config.
2. Discover the eight approval-profile tools.
3. Run one synthetic `sanction_authorize_tool` with `require_approval: true`.
4. Owner decides in the Sanction dashboard.
5. Host honors the decision contract: authorize → check once; if the check is still pending, tell the owner and do not re-check; on approval, redeem the single-use arg-bound grant exactly once; on replay or deny, stop.

Record what the live Bot actually did. A failed OAuth attempt with a dated capture is a valid spike result. It is not a substitute success.

### In scope

- Grok Bot as the MCP host.
- Hosted Streamable HTTP at `/mcp/approvals` (OAuth primary; agent-key only as a labeled diagnostic if OAuth cannot start).
- Dashboard as the human-decision surface for this sprint.
- Synthetic `demo.noop` / `sanction.demo.approval` style tool authorization that **executes no target action**.
- An evidence packet modeled on the [Slack review packet](SLACK-SUBMISSION.md) (date, deployed commit, host/version, sanitized input/result, pass/fail, private storage).

### Non-goals

- Claiming Grok Bot works, a Connect-apps listing, or www copy that implies Bot support.
- Real spend, provisioning, credential injection, execution tokens, or write logging. A read-only `sanction_wallet_status` smoke is allowed.
- Using `/mcp` (10 tools), stdio `npx sanction-mcp`, or `/mcp/broker/<name>`.
- Citing consumer Grok (grok.com/connectors, OAuth 2026-10-06), Grok Build ([xAI PR #1156](https://github.com/xai-org/plugin-marketplace/pull/1156)), or Cursor IDE as Bot evidence.
- Intercepting the Bot's other tools. `/mcp/approvals` is cooperative: the host must ask and honor the answer.
- Policy, tool, or OAuth code changes unless a recorded Bot failure names a Sanction bug — then stop and re-plan; do not patch in this spike.
- Slack as the required decision surface. Slack may notify; the owner decides in the dashboard.

## Honest current state

### What ships (Sanction)

| Surface | Shipped behavior | Proof in this repo, not on Grok Bot |
| --- | --- | --- |
| Approvals MCP | `POST/GET/DELETE /mcp/approvals` — Streamable HTTP, eight-tool allowlist | `app/mcp/approvals/route.ts`, `APPROVAL_MCP_TOOLS` in `lib/mcpServer.ts`, `tests/mcp-approvals.route.test.ts` |
| Eight tools | `sanction_authorize`, `sanction_authorize_provision`, `sanction_authorize_tool`, `sanction_authorize_capability`, `sanction_log_tokens`, `sanction_log_outcome`, `sanction_wallet_status`, `sanction_check_authorization` | Allowlist + route tests. Direct calls to `sanction_request_execution` / `sanction_inject_credential` fail before any API dispatch |
| OAuth | Live on getsanction.com (enabled 2026-09-30). Auth code + S256 PKCE + DCR. Resource is origin + `/mcp/approvals`. Scope `sanction:approvals` (+ `offline_access` for refresh). Discovery at `/.well-known/oauth-authorization-server/api/auth`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp/approvals` | [MCP-OAUTH.md](MCP-OAUTH.md), `lib/mcpOAuthProvider.ts`. Other deployments default to disabled |
| API key | `x-api-key: pxy_…` or `Authorization: Bearer pxy_…` still works on `/mcp/approvals`. Reduced **tool** surface, not a reduced credential — the same key still reaches other authorized endpoints | `app/mcp/approvals/route.ts` (OAuth never falls back to key auth) |
| Full wallet | `/mcp` and stdio `sanction-mcp` 0.10.0: ten tools, API key only | `app/mcp/route.ts`, `packages/sanction-mcp/` |
| Broker | `/mcp/broker/<name>` intercepts `tools/call` and filters `tools/list` | BROKER-1 / BROKER-2. Not this sprint |
| Decision contract | Tools return readable text, a JSON text block, and `structuredContent`. `isError: false` is not permission. Hosts must read `authorized` and `next_action` | `lib/mcpDecisionResult.ts`, `tests/mcpDecisionContract.test.ts`, [MCP-OAUTH.md](MCP-OAUTH.md) |
| Bounded wait | [#362](https://github.com/ericlovold/sanction/pull/362): pending authorize → wait, then `sanction_check_authorization` **once**. [#363](https://github.com/ericlovold/sanction/pull/363): a pending **check** says tell the owner; do not check again automatically | `lib/mcpDecisionResult.ts` remediation; changelog 2026-10-08 |
| Grants | Human approval mints a single-use grant bound to canonical tool/server/arguments (TOOL-BIND-1). Replay → `GRANT_ALREADY_USED` (409). Changed args → `GRANT_MISMATCH` | `lib/grants.ts`, `lib/toolRequest.ts`, `tests/tool-grant.db.test.ts` |

OAuth tokens cannot call `/mcp`, the broker, REST vault, or `/exec`. Disconnect at `/connect/mcp`.

### What is verified on which host

| Host | Evidence | Not evidence of |
| --- | --- | --- |
| Claude custom connector | Production OAuth, eight tools, one-off `require_approval`, exact redemption, consumed-grant refusal (2026-10-01). Community listing observed 2026-10-06 | Grok Bot |
| Grok **consumer** (grok.com/connectors) | Custom `/mcp/approvals` OAuth completed 2026-10-06; Sanction Approvals Connected/Added; eight tools enabled; one `sanction_wallet_status` with zero pending. No authorize or write | Grok Bot. Approval lifecycle still pending on consumer too |
| Grok **Build** | [xAI catalog PR #1156](https://github.com/xai-org/plugin-marketplace/pull/1156) open 2026-10-11; security checks pass; no reviews. Package is ten-tool `/mcp` + agent key | Grok Bot. Not the approvals profile |
| Cursor IDE | Marketplace rejected; community submission scanning/unpublished 2026-10-06. Authenticated lifecycle pending | Grok Bot |
| Grok **Bot** | None. Public publisher route unverified. Official Bot docs (fetched 2026-10-15) document Connect-apps plugins, not a custom MCP form | — |

Grok Bot inherits the Cursor team's connector policy ([teams and enterprises](https://docs.x.ai/grok-bot/teams-and-enterprises)). Connectors are account-wide on a shared cloud computer. Bot names do not isolate credentials. A dedicated Sanction demo agent is still required; it cannot prove which Bot used a shared connection.

### Decision contract the host must obey

From `lib/mcpDecisionResult.ts` and [MCP-OAUTH.md](MCP-OAUTH.md):

| Result | `authorized` | `next_action` | Required host behavior |
| --- | --- | --- | --- |
| Authorize succeeds | `true` | `proceed` | For this spike: report and **do not** invoke the synthetic target |
| Pending / escalated **authorize** | `false` | `wait` | Pause. After the owner says they decided, call `sanction_check_authorization` **once** with `request_id` |
| Pending / escalated **check** | `false` | `wait` | Still open. Tell the owner. Do not check again automatically. Do not open a new request |
| Check sees an active grant | `false` | `retry_with_grant` | Retry the **identical** `sanction_authorize_tool` plus `grant_id`. Execute only if that call returns `authorized: true` |
| Deny, consumed, expired, revoked, missing, malformed | `false` | `stop` | Stop. Do not retry or auto-request another approval |

`require_approval: true` pauses even in observe mode and never auto-approves on timeout.

## Success criteria (demoable)

All must be observed on **Grok Bot** against production `https://getsanction.com/mcp/approvals`, with a dedicated demo agent. Record host/version, date, deployed Sanction commit, sanitized input/output. No keys, tokens, or usable grants in public captures.

| # | Criterion | Pass looks like |
| --- | --- | --- |
| 1 | OAuth connect from Grok Bot | Bot adds the approvals URL with no hand-edited config. Sanction consent identifies the client, owner picks the demo agent, Bot shows the connector connected. Agent key is **not** pasted into chat |
| 2 | `tools/list` is the eight-tool profile | The eight names above are present. `sanction_request_execution` and `sanction_inject_credential` are absent |
| 3 | One `require_approval` escalation | `sanction_authorize_tool` with `require_approval: true` returns `authorized: false`, `status: escalated`, `next_action: wait`, and a `request_id`. The matching `PendingApproval` appears in `/dashboard/approvals` for that agent |
| 4 | Bounded wait | While pending, at most one `sanction_check_authorization`. If still pending, the Bot tells the owner and does not poll. Authorize-pending still instructs a single later check ([#362](https://github.com/ericlovold/sanction/pull/362) / [#363](https://github.com/ericlovold/sanction/pull/363)) |
| 5 | Approve → redeem once | Owner **Approves** in the dashboard. One check returns `next_action: retry_with_grant` and `grant_id`. Retry with identical tool/server/arguments plus that `grant_id` returns `authorized: true`, `next_action: proceed`. **No target execution** |
| 6 | Replay stops | The same `grant_id` retried again returns `authorized: false`, `code: GRANT_ALREADY_USED`, `next_action: stop`. Bot stops |
| 7 | Deny path | A **separate** request is denied in the dashboard. Check (or the Bot's handling) yields `next_action: stop`. No replacement request, no grant redemption, no target execution |
| 8 | Evidence packet | Private record covering rows 1–7, in the template below. Incomplete rows stay **pending**, never implied-pass |

A key-header connect that skips OAuth can be recorded as a **diagnostic**, labeled as such. It does not satisfy row 1.

## Open risks / unknowns

Verify each against the live Bot. Do not fill from Claude, consumer Grok, or unofficial wikis.

1. **OAuth discovery / DCR.** Sanction advertises protected-resource metadata and allows unauthenticated DCR with PKCE. Unknown: whether Grok Bot performs OAuth from Cursor infrastructure, which `redirect_uri` it registers, and whether that URI is HTTPS (Sanction/Better Auth) or a `cursor://` callback that HTTPS-only providers reject. A connect that never reaches Sanction consent is a Bot/client issue until a capture shows Sanction returning 4xx/5xx.
2. **OAuth vs key.** This sprint's success path is OAuth. Official Bot docs (2026-10-15) describe catalog plugins with browser auth, not a custom MCP key field. If the live UI offers a header/key and OAuth cannot start, record both. Do not paste `pxy_` into chat or a "secure secret" prompt unless that is the host's documented secret field **and** OAuth has already failed on the record.
3. **How to add the connector.** Official [computer and apps](https://docs.x.ai/grok-bot/computer-and-apps): Connect apps → plugin → Add → authenticate → attach with `@`. That page does not document an arbitrary custom MCP import. The spike must write down the actual clicks or prompt that added `https://getsanction.com/mcp/approvals`. If the Bot cannot add a URL the host docs do not support, stop at that limitation.
4. **Connector custom instructions.** Unknown whether Grok Bot has a connector-level instruction field (Claude-style), and whether it is required for the host to honor `next_action`. Do not ship public instruction copy. If a field exists, record its presence and whether the bounded-wait prompt was needed.
5. **How pending results render.** Claude initially surfaced text-only decisions and treated ordinary denials as failed tool calls until the JSON text fallback. Unknown: whether Grok Bot exposes `structuredContent`, the JSON text block, or only prose; whether `next_action: wait` is shown as an error; whether the Bot retries or polls on its own.
6. **Session / protocol headers.** Unverified on Bot: Streamable HTTP session reuse, `MCP-Protocol-Version` on later requests, and whether a connected connector later returns empty HTTP 400.
7. **Shared-account boundary.** Account-wide connectors + shared computer. Record which Cursor/xAI account and which Bot name were used. Do not use a production wallet.
8. **Team policy.** On a Cursor team, Plugins & MCPs / MCP allowlist can block a custom server. Record Disabled-by-admin vs a Sanction failure.
9. **Attach with `@`.** Catalog plugins are attached per chat. Unknown whether a custom approvals connector must be `@`-mentioned for `tools/list` and calls.

## Spike steps

Use a dedicated demo wallet and agent. Owner email verified before issuing the demo key (first claim rotates pre-claim keys). Keep `sk_` out of the Bot. Synthetic only.

1. **Capture the live add-connector UI.** Open Grok Bot. Photograph Connect apps / plugins / any custom MCP entry. Write the exact steps. If there is no supported way to add a public HTTPS MCP URL, stop and record the limitation.
2. **Add `/mcp/approvals`.** URL `https://getsanction.com/mcp/approvals`, Streamable HTTP. Prefer OAuth. Do not edit `mcp.json` or host config files. Do not put keys in chat.
3. **Complete consent.** Sanction login (verified Google/GitHub/Apple or existing-account email link — not `sk_`). Select the demo agent. Confirm the Bot shows connected. Note client name, redirect, and whether DCR ran.
4. **List tools.** Ask the Bot to list Sanction tools only. Expect the eight names; expect the two wallet-only tools absent. Optional: `sanction_wallet_status` with `{}` — success is connection, not enforcement.
5. **Escalate once.** Prompt (adapt from [CONNECT.md](CONNECT.md); do not paste secrets):

   > Ask Sanction for my approval to run `sanction.demo.approval` with arguments `{"synthetic":true,"execute":false}` and no server. Set `require_approval` to true and `approval_reason` to "SANCTION-S1 Grok Bot spike; executes nothing." Make one `sanction_authorize_tool` call, show the request ID, then stop. Do not execute, retry, or poll automatically.

   Expect `authorized: false`, `status: escalated`, `next_action: wait`. Confirm the request in `/dashboard/approvals`.
6. **Pending check once.** If the Bot already checked, record that. Otherwise ask it to `sanction_check_authorization` once. Expect `next_action: wait` and owner-facing "still awaiting" text — not another check.
7. **Approve in the dashboard.** Open the exact request, review arguments, Approve. Then ask the Bot to check once. Expect `retry_with_grant` + `grant_id`. Retry the **saved original arguments** plus `grant_id`. Expect `authorized: true`. Report; execute nothing.
8. **Replay.** Same `grant_id` again. Expect `GRANT_ALREADY_USED` / `next_action: stop`. Confirm the Bot stops.
9. **Deny path.** New `require_approval` request (different `approval_reason` or arguments). Deny in the dashboard. Expect `stop`, no grant reuse, no new auto-request.
10. **Write the evidence packet.** Fill the template. Leave gaps marked pending. Do not update public docs or undraft this PR.

If step 2–3 fail, keep the capture and stop. Do not "make it work" with `/mcp`, stdio, or a hand-written Cursor MCP file.

## Eric-gates

Until the evidence packet has observed passes for success rows 1–7:

- **Do not merge** this PR, and do not merge a follow-up that claims Grok Bot works.
- **Do not undraft** this PR.
- **Do not spend** (no real purchase, provision, credential inject, or non-synthetic authorize).
- **Do not promote www** — no edits to `lib/docs.ts`, `docs/CONNECT.md`, `docs/GROK-BOT.md`, homepage, `/docs/connect`, or marketplace listing copy that imply Bot support.
- **Do not make public claims** (social, sales, directory text, changelog "Grok Bot") that Sanction works in Grok Bot.

Consumer Grok Connected/Added (2026-10-06) and Grok Build PR #1156 must not be cited as Bot proof.

Engineering may keep this draft open and attach evidence. Changing the claim from "spike" to "verified" is an Eric decision after the packet exists.

## Evidence packet (private)

Mirror [Slack's evidence record](SLACK-SUBMISSION.md#evidence-and-submission-record). Store credentials only in the secrets store. Public issues/PRs get sanitized summaries at most.

Retain per check: **date; Grok Bot app version; Cursor/xAI account type (personal/team); Bot name; deployed Sanction commit (production); fixture policy; connector add path; auth method actually used; sanitized tool input; `authorized` / `status` / `next_action` / `code`; dashboard request id (private); pass/fail; capture location.**

- [ ] Live add-connector UI captured; actual steps written.
- [ ] OAuth consent completed from Grok Bot to `/mcp/approvals` (or dated OAuth failure).
- [ ] Eight tools listed; excluded tools absent.
- [ ] Optional `sanction_wallet_status` read-only smoke.
- [ ] One `require_approval` escalation visible in `/dashboard/approvals`.
- [ ] At most one pending check; Bot told the owner rather than polling.
- [ ] Dashboard approve → `retry_with_grant` → identical-arg redeem once → `authorized: true`; no target execution.
- [ ] Grant replay → `GRANT_ALREADY_USED` → Bot stopped.
- [ ] Separate deny → `stop`; no replacement request.
- [ ] Shared-account / team-policy notes recorded.
- [ ] Custom-instruction field: present or absent, and whether it was needed.
- [ ] How pending/`wait` rendered (structured, JSON text, prose-only, or error).

**Done for SANCTION-S1:** rows 1–7 observed on Grok Bot, packet stored, Eric unblocks any public claim.

**Still not done then:** Connect-apps listing, publisher route, reconnect/revoke, token refresh, argument-tamper (`GRANT_MISMATCH`) unless already captured, broker enforcement, or www copy.

## Related

- [Marketplace board](MARKETPLACE-SUBMISSION.md) — Grok Bot row points here; listing is a later gate
- [Grok Bot connection boundaries](GROK-BOT.md) — public guide; still does not claim Bot compatibility
- [Connect](CONNECT.md) — host setup; Grok consumer ≠ Grok Bot
- [MCP OAuth and decisions](MCP-OAUTH.md) — contract and Claude evidence
- [Slack review packet](SLACK-SUBMISSION.md) — evidence-record shape
