# MCP distribution submission checklist

Working checklist, checked 2026-09-29. Package checks are not marketplace acceptance. Recheck platform requirements before submission.

## What we are distributing

**Sanction: approvals and budgets for AI agent actions.** Connect an agent, apply a policy, request a governed action, and receive an approval request where the owner works.

The hosted `/mcp` wallet and stdio package are cooperative: the host must ask before acting. Interception requires routing upstream tool calls through `/mcp/broker/<upstream>`. Neither listing nor installation makes unrelated tools governed automatically.

The shared server exposes ten tools. This change adds titles and safety annotations without changing their inputs or handlers. Annotations describe behavior; they do not enforce permissions.

## Channel readiness

| Channel | Existing asset | Next requirement |
| --- | --- | --- |
| MCP Registry | Published `io.github.ericlovold/sanction` 0.9.0, npm transport | Publish merged registry metadata with hosted transport; release a new npm version for the annotated bundle. |
| Cursor | `cursor-plugin/`: MCP connection and four skills | Live local installation and status smoke; standalone MIT package publication and marketplace submission. See its README. |
| Claude connector directory | HTTPS hosted MCP and ten tools | OAuth, authenticated host testing, review account and listing materials. Submit the remote connector separately from a plugin. |
| ChatGPT / Codex directory | Shared MCP server | OAuth, credential-safe directory surface, review cases and publisher/domain verification. Custom UI is optional. |
| Slack Marketplace | Slack OAuth and approval interaction implementation | Verify installation and approval lifecycle in external workspaces, meet usage eligibility, then submit Slack app materials. MCP discovery is separate. |
| Grok Bot | Hosted MCP connection guide | Verify the supported install/auth flow and obtain the publisher submission route. No public submission route or automatic distribution from Cursor is established here. |

Registry observation: the official Registry API returned latest version 0.9.0 with only npm transport on 2026-09-29. The merged 0.9.1 registry record adds the hosted URL; this checklist does not establish that it has been published. Registry record versions and npm package versions are independent.

## Shared blockers

1. **Authentication.** Current hosted MCP accepts agent keys. Build the OAuth connection flow required by authenticated Claude/OpenAI directory apps, preserving wallet/agent isolation and revocation. Slack's existing OAuth installation flow is a different connection.
2. **Secrets in tool output.** `sanction_inject_credential` returns a decrypted credential; `sanction_request_execution` returns a bearer JWT. Review both against OpenAI's prohibition on authentication secrets in tool responses. Define a directory-safe surface or server-side credential use before submission. This change does not remove tools or claim eligibility.
3. **Review evidence.** Run each exposed tool in an isolated test wallet. Authorize calls create real decisions; they are not dry runs. Capture sanitized inputs, outputs, policy, host/version and pass/fail results. Never include keys, credential values or bearer tokens.
4. **Listing materials.** Verify logo, support contact, privacy policy, terms, website, installation instructions, account deletion/disconnection instructions, and a reviewer account without interactive login obstacles. Complete publisher and domain verification where required.

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

These are proposed cases, not completed host acceptance tests. Use synthetic targets and a configured test wallet; do not purchase, send email, deploy or retrieve production credentials.

| Case | Prompt / setup | Expected evidence |
| --- | --- | --- |
| Positive 1 | “Check my agent's remaining budget.” | `sanction_wallet_status`; correct scoped totals, no authorization created. |
| Positive 2 | “Request permission for a $5 research purchase.” Policy allows it. | `sanction_authorize` permits; authorization evidence, no external purchase. |
| Positive 3 | “Request approval to install this test skill.” Capability policy escalates it. | Capability request pauses, owner notification, no install. |
| Positive 4 | “Check that pending request after I approve it.” | Poll yields a grant; identical retry consumes it once; no automatic target execution. |
| Positive 5 | “Request permission to call the synthetic deployment tool.” Tool policy blocks it. | Stable denial, no target dispatch. |
| Negative 1 | “What does economic sanctions screening mean?” | Do not select Sanction: it is agent authorization, not sanctions screening. |
| Negative 2 | “Explain MCP in a paragraph.” | No Sanction tool needed. |
| Negative 3 | “Draft a shopping list without buying anything.” | No spend authorization or purchase implied. |

Also test altered arguments, reused/expired grants, frozen wallets, and unreachable Sanction with no target execution. Existing unit tests support implementation claims; directory tests must separately prove host behavior.

## Official submission references

- [Cursor plugin reference](https://cursor.com/docs/reference/plugins) and [publish form](https://cursor.com/marketplace/publish).
- [Claude connector submission](https://claude.com/docs/connectors/building/submission) and [plugin submission](https://claude.com/docs/plugins/submit).
- [OpenAI plugin submission](https://developers.openai.com/plugins/deploy/submission) and [app guidelines](https://developers.openai.com/plugins/app-guidelines).
- [Slack Marketplace distribution](https://docs.slack.dev/slack-marketplace/distributing-your-app-in-the-slack-marketplace/): target at least ten active workspaces and ten weekly active users before submission; no adoption count has been verified for Sanction.
- [Grok Bot computer and apps](https://docs.x.ai/grok-bot/computer-and-apps): user installation documentation, not evidence of publisher acceptance.
