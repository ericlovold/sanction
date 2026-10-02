# MCP distribution submission checklist

Working checklist, checked 2026-10-02. Start with the [connection guide](CONNECT.md) ([public version](https://getsanction.com/docs/connect)). Connection tests, package checks and marketplace acceptance are separate milestones.

## What we are distributing

**Sanction: approvals and budgets for AI agent actions.** Connect a wallet and agent, then request one human approval with `sanction_authorize_tool` and `require_approval: true`; no policy edit is required. Hard denials still apply. The owner decides through the existing approval flow, and the host must redeem the single-use grant before proceeding.

The hosted `/mcp` wallet and stdio package are cooperative: the host must ask before acting. Interception requires routing upstream tool calls through `/mcp/broker/<upstream>`. Neither listing nor installation makes unrelated tools governed automatically.

The full wallet exposes ten tools with titles and safety annotations. Annotations describe behavior; they do not enforce permissions.

## Approval-focused endpoint

`POST /mcp/approvals` exposes eight existing tools through an explicit server-side allowlist: spend, provision, tool and capability authorization; token and outcome logging; wallet status; and authorization polling. It does not register `sanction_request_execution` or `sanction_inject_credential`. Direct calls to either excluded name fail before any downstream API call.

For local protocol testing, use the same `x-api-key: pxy_...` header and MCP client setup as `/mcp`, with the URL changed to `/mcp/approvals`. `GET` and `DELETE` use the same authenticated transport. There is no browser setup page at this URL. Prefer `sanction_wallet_status` for a read-only smoke test; other calls can create real decisions or records.

The route fixes the profile; query parameters, headers and tool arguments cannot widen it. `/mcp`, stdio and the Cursor package retain all ten tools. No new tool is introduced.

This is a reduced tool surface, **not a restricted credential**. The supplied agent key still works against other authorized Sanction endpoints. The [OAuth connection flow](MCP-OAUTH.md) separately constrains tokens to this resource and scope. It was enabled on getsanction.com on 2026-09-30; other deployments default to disabled. The endpoint remains cooperative and still returns request/grant identifiers needed for the approval loop; it is not a claim that arbitrary tool output is scrubbed of secrets or that marketplace review is complete.

## Channel readiness

| Channel | Current evidence | Next requirement |
| --- | --- | --- |
| MCP Registry / npm | Registry 0.9.0 with npm transport observed 2026-09-29; npm 0.9.0 remains the older bundle | Publish hosted registry metadata and a new npm bundle separately; neither is published by this guide. |
| Claude | Production custom OAuth connector; 2026-10-01 synthetic request → approval → redemption → reuse denial, with no external action | Complete fresh-login/refresh and full-tool review cases; submit the remote connector separately from any plugin. |
| Cursor | Direct remote MCP/OAuth configuration and install links are supported; `cursor-plugin/` contains MCP configuration and four skills | Verify Sanction in Cursor, then publish the standalone package and submit its public repository. No Cursor acceptance is claimed. |
| Codex | Custom remote MCP path in the connection guide; OpenAI plugin packaging supports MCP and skills | Verify Sanction connection and approval lifecycle in Codex; prepare the reviewed plugin package. |
| ChatGPT | Remote MCP plugin distribution path; package and review pending | Verify Sanction in ChatGPT, remaining outputs/grants and review cases; complete publisher/domain verification. UI is optional. |
| Grok consumer | Official custom MCP flow: Connectors → New Connector → Custom | Test Sanction authentication and approval lifecycle; consumer support does not prove Grok Bot compatibility. |
| Grok Bot | Official Marketplace → Add → authenticate → attach with `@`; connectors are account-wide | Establish a supported Sanction install and publisher route. No arbitrary import or automatic Cursor distribution is established. |
| xAI API | Remote MCP supports Streamable HTTP/SSE, headers and tool allowlists | Run a wallet-status-only Sanction smoke before an approval lifecycle; API support is separate from consumer catalogs. |
| Slack Marketplace | Slack OAuth and approval interaction implementation | Verify external-workspace lifecycle and usage eligibility, then submit Slack app materials. MCP discovery is separate. |

The Claude results are dated historical evidence, not a fresh test of every host. Fresh social-provider login and automatic refresh remain unverified. The Registry's merged 0.9.1 metadata adds the hosted URL, but publication is unverified; registry record versions and npm versions are independent.

## Shared blockers

1. **Authentication.** Production OAuth is enabled for `/mcp/approvals`. Repeat connection, fresh sign-in, refresh and disconnection in each target host. Claude supports DCR; fixed request headers are a limited beta, not the default onboarding path. Slack OAuth is a separate installation.
2. **Secrets in tool output.** `sanction_inject_credential` returns a decrypted credential; `sanction_request_execution` returns a bearer JWT. Review both against OpenAI's prohibition on authentication secrets in tool responses. The approval-focused route excludes both tools. Remaining responses, including the one-use grant flow and user-supplied text, still require review before claiming directory eligibility.
3. **Review evidence.** Run every exposed tool in an isolated test wallet. Authorization calls create real decisions. Capture sanitized inputs, outputs, policy, host/version and results. OpenAI requires exactly five positive and three negative cases; the candidates below still need host-specific execution. Never include secrets.
4. **Listing materials.** Prepare logo, support contact, privacy policy, terms, website, setup and disconnection instructions. OpenAI requires identity/domain verification, a reviewer-accessible video walkthrough, and a fully populated reviewer account without MFA, email/SMS codes or magic links. Package MCP and skills in its plugin ZIP; a Cursor package is not automatically that artifact. Claude requires a paid submitting account and its own connector submission.

## Tool metadata rationale

Only `sanction_wallet_status` is marked read-only and idempotent. It reads scoped budget and approval counts. Authentication bookkeeping is incidental to the tool's operation.

| Tool group | Side effects reflected in annotations |
| --- | --- |
| Four `sanction_authorize*` tools | May consume grants, change authorization/budget state, and notify owners or webhooks. Marked destructive conservatively because existing authority can be spent; they do not themselves perform the requested purchase/tool/install. |
| `sanction_check_authorization` | Polling can settle an expired approval and mint a grant. Mutating, closed-world; timeout settlement does not invoke the human-resolution webhook path. |
| `sanction_log_tokens` | Adds metered usage and may send budget notifications. Additive, open-world, not idempotent. |
| `sanction_log_outcome` | Adds an outcome inside Sanction. Optional dedupe key does not justify a blanket idempotency claim. |
| `sanction_request_execution` | Creates scoped authority. Additive and closed-world; not read-only or retry-safe by annotation. |
| `sanction_inject_credential` | Retrieves a secret, adds an audit record, and can replace stored ciphertext during lazy key rotation. Destructive conservatively and closed-world; these hints do not imply that exposing the secret to a host is safe. |

Closed-world tools still call the Sanction API. The distinction concerns the resources and side effects involved, not whether a network request occurs.

## Candidate directory review cases

These five positive and three negative cases are a review set to execute per host. A historical Claude smoke does not complete the set. Use a test wallet and synthetic targets; do not purchase, send, deploy or retrieve production credentials.

| Case | Prompt / setup | Expected evidence |
| --- | --- | --- |
| Positive 1 | “Check my agent's remaining budget.” | `sanction_wallet_status`; correct scoped totals, no authorization created. |
| Positive 2 | “Request permission for a $5 research purchase.” Policy allows it. | `sanction_authorize` permits; authorization evidence, no external purchase. |
| Positive 3 | “Ask for my approval to run `demo.noop`.” Use `sanction_authorize_tool` with `require_approval: true`; no policy edit. | Pending request and owner notification; no target execution. |
| Positive 4 | “Check that pending request after I approve it.” | Poll yields a grant; identical retry consumes it once; no automatic target execution. |
| Positive 5 | “Request permission to call the synthetic deployment tool.” Tool policy blocks it. | Stable denial, no target dispatch. |
| Negative 1 | “What does economic sanctions screening mean?” | Do not select Sanction: it is agent authorization, not sanctions screening. |
| Negative 2 | “Explain MCP in a paragraph.” | No Sanction tool needed. |
| Negative 3 | “Draft a shopping list without buying anything.” | No spend authorization or purchase implied. |

Also test altered arguments, reused/expired grants, frozen wallets, and unreachable Sanction with no target execution. Existing unit tests support implementation claims; directory tests must separately prove host behavior.

## Official submission references

- [Claude submission](https://claude.com/docs/connectors/building/submission) and [authentication](https://claude.com/docs/connectors/building/authentication): remote HTTPS connector, OAuth, tool annotations, review account and listing materials; submit at [the developer portal](https://claude.ai/directory/manage).
- [Cursor plugin requirements](https://cursor.com/docs/reference/plugins) and [publish form](https://cursor.com/marketplace/publish): locally tested plugin in a public Git repository. [Direct MCP installation](https://cursor.com/docs/mcp/install-links) does not require marketplace acceptance.
- [OpenAI plugin submission](https://developers.openai.com/plugins/deploy/submission), [remote MCP review requirements](https://developers.openai.com/plugins/deploy/app-review) and [guidelines](https://developers.openai.com/plugins/app-guidelines): plugin ZIP distribution spans ChatGPT and Codex; verify each host separately.
- [Grok consumer connectors](https://docs.x.ai/grok/connectors), [Grok Bot connections](https://docs.x.ai/grok-bot/computer-and-apps) and [xAI API remote MCP](https://docs.x.ai/developers/tools/remote-mcp) describe different installation surfaces. The API's `require_approval` parameter is unsupported; that is distinct from Sanction's tool argument.
- [Slack Marketplace distribution](https://docs.slack.dev/slack-marketplace/distributing-your-app-in-the-slack-marketplace/): target at least ten active workspaces and ten weekly active users before submission; Sanction adoption counts are unverified.
