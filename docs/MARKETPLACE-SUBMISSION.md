# MCP distribution submission checklist

Working checklist, updated 2026-10-06. Start with the [connection guide](CONNECT.md) ([public version](https://getsanction.com/docs/connect)). Connection tests, package checks and marketplace acceptance are separate milestones.

## What we are distributing

**Sanction: approvals and budgets for AI agent actions.** Connect a wallet and agent, then request one human approval with `sanction_authorize_tool` and `require_approval: true`; no policy edit is required. Hard denials still apply. The owner decides through the existing approval flow, and the host must redeem the single-use grant before proceeding.

The hosted `/mcp` wallet and stdio package are cooperative: the host must ask before acting. Interception requires routing upstream tool calls through `/mcp/broker/<upstream>`. Neither listing nor installation makes unrelated tools governed automatically.

The full wallet exposes ten tools with titles and safety annotations. Annotations describe behavior; they do not enforce permissions.

## Approval-focused endpoint

`POST /mcp/approvals` exposes eight existing tools through an explicit server-side allowlist: spend, provision, tool and capability authorization; token and outcome logging; wallet status; and authorization polling. It does not register `sanction_request_execution` or `sanction_inject_credential`. Direct calls to either excluded name fail before any downstream API call.

For local protocol testing, use the same `x-api-key: pxy_...` header and MCP client setup as `/mcp`, with the URL changed to `/mcp/approvals`. `GET` and `DELETE` use the same authenticated transport. There is no browser setup page at this URL. Prefer `sanction_wallet_status` for a read-only smoke test; other calls can create real decisions or records.

The route fixes the profile; query parameters, headers and tool arguments cannot widen it. `/mcp`, stdio and the Cursor package retain all ten tools. No new tool is introduced.

This is a reduced tool surface, **not a restricted credential**. The supplied agent key still works against other authorized Sanction endpoints. The [OAuth connection flow](MCP-OAUTH.md) separately constrains tokens to this resource and scope. It was enabled on getsanction.com on 2026-09-30; other deployments default to disabled. The endpoint remains cooperative and still returns request/grant identifiers needed for the approval loop; it is not a claim that arbitrary tool output is scrubbed of secrets or that marketplace review is complete.

## Submission board

Observations are dated below; connector status updated 2026-10-06 (America/Chicago). Checked boxes mean observed evidence,
not assumed acceptance. **Engineering** prepares artifacts and fixes; **Eric**
owns accounts, identity, legal approval and submission; **Together** runs host tests.
Portal identity, eligibility and review status must be checked in the actual account.

| Provider | Artifact / route | Current Sanction evidence | Next gate |
| --- | --- | --- | --- |
| MCP Registry / npm | `packages/sanction-mcp/` | 0.10.0 published; hosted `/mcp` entry verified | Complete; monitor releases separately from directories |
| Claude | Remote connector | [Community listing](https://claude.ai/directory/sanction-approvals) renders all eight tools, observed 2026-10-06 | Fresh installation and recorded host lifecycle remain unverified |
| ChatGPT + Codex | `packages/sanction-approvals/` ZIP | 0.1.0 draft needs attention; MCP configured and authorized, domain verified, skill checks pass (2026-10-06) | Public terms URL, reviewer credentials, video, tool review and host evidence |
| Cursor | [Public MIT plugin](https://github.com/ericlovold/sanction-plugin) | Marketplace rejected per publisher email; [community submission](https://cursor.directory/plugins/sanction) scanning, unpublished and hidden (2026-10-06) | Community security scan and authenticated host test; no public listing established |
| Grok Build | Public plugin catalog PR | [xAI PR #1156](https://github.com/xai-org/plugin-marketplace/pull/1156) open with successful security checks and no reviews, checked 2026-10-06 | Catalog review and authenticated host tests; publication pending |
| Grok consumer | Custom MCP connection | OAuth completed; Sanction Approvals appears Connected and Added (2026-10-06) | Eight tools visible and enabled; invocation and lifecycle tests pending; public catalog route unverified |
| Grok Bot | Marketplace plugin | Public publisher route unverified | Confirm route with xAI before preparing a claimed submission |
| Slack | Slack app submission | Portal says not distributed; submission disabled. [Review packet / landing-page PR #347](https://github.com/ericlovold/sanction/pull/347) prepared | Audit legacy token delivery before public-distribution attestation, then external-workspace proof and usage eligibility |

Connector completion precedes activation and go-to-market work; listing presence alone does not complete the host tests.

### Shared preparation — do once, reuse carefully

- [x] **Engineering:** Publish MCP 0.10.0 to npm and the official Registry. [Successful workflow](https://github.com/ericlovold/sanction/actions/runs/37089864969).
- [x] **Engineering:** Complete the production canary across all three personas. [Passing run](https://github.com/ericlovold/sanction/actions/runs/37089772489).
- [x] **Engineering:** Verify public `/privacy` and `/support` return HTTP 200.
- [ ] **Eric + Engineering:** Approve and publish terms; `/terms` returned 404 on 2026-10-06. Add the URL to relevant listing manifests.
- [ ] **Together:** Prepare a dedicated reviewer identity, sample data and host-specific login instructions. Do not weaken production authentication for review.
- [ ] **Engineering:** Assemble logo, concise one-off approval description, setup/disconnection guide, annotation rationale and versioned release notes.
- [ ] **Together:** Record the actual host, version, date, input, sanitized result and outcome for every case. No credentials in recordings, packages or public reports.

The backend harness in [PR #342](https://github.com/ericlovold/sanction/pull/342)
passed eight scenarios twice against disposable local Postgres. Merged in #342; this remains backend-only evidence. It uses scripted owner decisions and in-memory MCP → REST;
it does **not** complete host, OAuth, human-review or recording requirements.

### Claude — remote connector first

Use the [Claude review packet](CLAUDE-SUBMISSION.md) for listing copy and tool-by-tool test inputs.

Portal: [Claude directory management](https://claude.ai/directory/manage).

On 2026-10-06, the [Sanction Approvals directory page](https://claude.ai/directory/sanction-approvals)
rendered a **Community** listing with all eight tools. This is listing evidence,
not Verified status or a fresh-install test. The portal receipt was recorded on
2026-10-03; recorded host lifecycle checks remain incomplete.

- [ ] **Eric:** Select the owning organization and confirm eligible account/role access. Keep ownership consistent if adding a plugin bundle later.
- [ ] **Engineering:** Prepare the HTTPS approval endpoint, OAuth discovery and supported client registration, tool titles and accurate safety annotations.
- [ ] **Together:** Test every exposed tool using MCP Inspector and a Claude custom connection with synthetic inputs; record approval, denial, redemption, reconnect and revocation behavior.
- [ ] **Engineering:** Audit Claude-specific annotation requirements: its review checklist calls for `destructiveHint: true` on data-modifying tools. Resolve any discrepancy with the current metadata rationale below before submission; do not assume existing annotations pass or change shared metadata without review.
- [ ] **Engineering:** Prepare listing copy, categories, icon, documentation, privacy/support links, prerequisites, data-handling answers and reviewer instructions.
- [ ] **Eric:** Supply a populated reviewer account privately and complete compliance declarations. Explain that Sanction grants permission; it does not transfer financial assets or execute purchases.
- [x] **Eric + Engineering:** Submit the remote connector and verify its Community directory entry (2026-10-06).
- [ ] **Together:** Verify a fresh installation and resolve any remaining host findings. Do not claim Verified status from a Community listing.
- [ ] **Engineering, if adding skills:** Build and validate a Claude-compatible plugin bundle, then submit it as a separate entry under the same organization and MCP URL. The Cursor/OpenAI package is not automatically a Claude submission.

**Done:** A published connector and recorded Claude behavior. Connector and
plugin-bundle review paths differ; do not assume OpenAI's publish steps apply.
[Directory publishing](https://claude.com/docs/directory/publish),
[connector submission requirements](https://claude.com/docs/connectors/building/submission),
[authentication](https://claude.com/docs/connectors/building/authentication),
[review criteria](https://claude.com/docs/connectors/building/review-criteria).

### ChatGPT and Codex — one OpenAI submission, separate host verification

Portal: [OpenAI Plugins](https://platform.openai.com/plugins).

On 2026-10-06, Sanction Approvals 0.1.0 is **Draft — Needs attention**.
MCP is configured and authorized, the domain is verified, and skill checks pass.
Five positive and three negative review cases are populated; their presence
is not execution evidence. Reviewer credentials and the video URL are blank.
The authorize/provision tools show a generic further-review notice; the portal
shows no specific schema fault to repair.

The required `interface.termsOfServiceURL` is absent. `/terms` returns 404 and
no approved alternative was found. Publish approved terms before adding the URL;
do not package a broken link as a completed gate.

- [x] **Eric + Engineering:** Create the draft, upload the package, authorize MCP and verify the domain (2026-10-06).
- [x] **Engineering:** Rebuild the ZIP from current `packages/sanction-approvals/`, including its MCP configuration and skill. Exclude secrets; do not upload an older archive missing `supportURL`.
- [ ] **Engineering:** Supply HTTPS website/support/privacy/terms URLs; validate listing fields, assets and tool annotations with justifications.
- [ ] **Eric + Engineering:** Resolve remaining listing and tool-review findings; obtain a successful review outcome.
- [ ] **Together:** Run exactly five positive and three negative cases with the review account; provide an accessible video and release notes.
- [ ] **Eric:** Enter reviewer credentials privately in the portal. Review access must work without interactive MFA, email/SMS codes, magic links or private-network access.
- [ ] **Together:** Verify installation and approval resumption separately in ChatGPT and Codex; a local MCP config is not a ChatGPT listing.
- [ ] **Eric:** Submit attestations and draft; after approval, explicitly publish.
- [ ] **Together:** Confirm the public listing and fresh install; record URLs and submission/version identifiers.

**Done:** Published listing plus recorded behavior on each claimed host. No custom
UI is currently packaged; screenshots are required only if UI is introduced.
[Submission procedure](https://developers.openai.com/plugins/deploy/submission),
[final validation requirements](https://developers.openai.com/plugins/deploy/submission-errors#final-directory-submission).

### Cursor — public plugin repository

Portal: [Cursor Marketplace publish](https://cursor.com/marketplace/publish).

Published package: [sanction-plugin](https://github.com/ericlovold/sanction-plugin),
version 0.1.0, commit `f0e079be6715b99b8a7d0dc4644ed1fd0543644e`. It contains
only the MIT plugin, with separate Cursor and Grok Build configurations. Both use
the full ten-tool `/mcp` profile and an agent key. The marketplace application
was rejected, per the publisher email reviewed on 2026-10-06.

A separate [Cursor Directory community submission](https://cursor.directory/plugins/sanction)
was created on 2026-10-06 through its [submission form](https://cursor.directory/plugins/new).
It reports a pending security scan and remains unpublished and hidden. The
scanner selected the repository's Grok configuration; the submitted MCP component
was corrected to the Cursor configuration: `/mcp` with
`x-api-key: ${SANCTION_AGENT_KEY}`. No credential value was submitted in that field.
Authenticated host testing remains pending.

- [x] **Engineering:** Extract the MIT `cursor-plugin/` package into its own public repository, with manifest, license, logo, four skills, MCP configuration and setup README at the supported root. Do not relabel the parent FSL repository as MIT.
- [x] **Engineering:** Validate manifest paths/frontmatter and every declared `${SANCTION_AGENT_KEY}` variable; remove all credential values.
- [ ] **Together:** Load the plugin locally in Cursor. Verify discovery, secret configuration, wallet status, request/pause, exact redemption and denial.
- [x] **Eric:** Submit the public repository URL and publisher application for manual review; portal receipt confirmed 2026-10-03.
- [ ] **Together:** Track the community security scan and resolve findings; verify any published listing and installation in a clean profile. Community acceptance does not reverse the marketplace rejection.

**Done:** Accepted public listing and a recorded Cursor lifecycle. A direct MCP
install link or successful local load is not marketplace acceptance. Cursor
requires open-source marketplace plugins; the standalone MIT package is our
chosen packaging path. [Plugin requirements](https://cursor.com/docs/reference/plugins),
[local testing](https://cursor.com/docs/plugins),
[publisher terms](https://cursor.com/marketplace-publisher-terms),
[marketplace security policy](https://cursor.com/help/security-and-privacy/marketplace-security).

### Grok Build — public plugin catalog

Submitted [xAI catalog PR #1156](https://github.com/xai-org/plugin-marketplace/pull/1156)
on 2026-10-03. The official route is a catalog pull request; consumer Grok and
Grok Bot remain separate distribution questions. On 2026-10-06, PR #1156 is
open, its security checks pass, and it has no reviews; publication remains pending.

- [x] **Engineering:** Publish the standalone MIT package and pin source commit `f0e079be6715b99b8a7d0dc4644ed1fd0543644e`.
- [x] **Engineering:** Add the Sanction entry and regenerate the index; full generation fetched the public source. `validate-catalog.py` and `generate-plugin-index.py --check` pass.
- [x] **Engineering:** Submit the catalog PR with ownership, endpoint, credential and scope disclosures.
- [ ] **Together:** Test installation and the approval lifecycle in authenticated Grok Build.
- [ ] **Together:** Resolve review findings and verify the published catalog entry with a fresh install.

The package uses `.grok-plugin/plugin.json` and `.mcp.json`. Grok's native
`bearer_token_env_var` supplies `SANCTION_AGENT_KEY` to the first-party `/mcp`
endpoint. Four skills accompany the full ten-tool wallet profile, including
execution-token creation and credential retrieval. There are no hooks or
executables. The PR explicitly discloses the environment read and broader
scope; it does not attest that this is an approvals-only connector.

**Done:** Accepted catalog entry and recorded Grok Build behavior.
[Official marketplace announcement](https://x.ai/news/grok-plugin-marketplace),
[catalog contribution requirements](https://github.com/xai-org/plugin-marketplace/blob/main/CONTRIBUTING.md).

### Grok consumer — custom connection first; catalog route unverified

Connection entry: [Grok Connectors](https://grok.com/connectors).

On 2026-10-06, a custom `/mcp/approvals` connection reached the real Sanction
OAuth consent page identifying Grok. After owner authorization, a dedicated
review agent was created and connected; OAuth returned to Grok with Sanction
Approvals shown as **Connected** and **Added**. Connection setup is verified;
all eight tools are visible and enabled. Invocation and lifecycle tests remain pending.

- [ ] **Eric:** Complete any account/terms steps personally; for a business team, confirm admin provisioning.
- [x] **Together:** Add the custom `https://getsanction.com/mcp/approvals` connector and complete OAuth (2026-10-06).
- [x] **Together:** Verify all eight tools are visible and enabled (2026-10-06).
- [ ] **Together:** Run the common approval evidence checks, reconnect and revoke. Record the supported account/plan and authentication behavior.
- [ ] **Eric:** Confirm the public catalog submission process with xAI; retain their actual publisher instructions before claiming a submission route.
- [ ] **Engineering:** Adapt listing materials to that confirmed process.

**Done for connection:** Repeatable custom installation and approval lifecycle.
**Done for distribution:** A separately verified public catalog listing. The
[official custom MCP guide](https://docs.x.ai/grok/connectors) documents connection,
not a public publisher application procedure.

### Grok Bot — verify its own marketplace path

- [ ] **Eric:** Confirm the supported publisher route and whether the intended Sanction package can appear in Bot's Marketplace. No automatic Cursor-to-Bot public listing is established here.
- [ ] **Together:** In the supported Marketplace flow, add the connector, authenticate, attach it with `@`, and test the approval lifecycle.
- [ ] **Eric / team admin:** Check Cursor's Plugins & MCPs / Team Marketplace policy for allowed servers. Bot inherits that connector policy; it has no independent team connector list.
- [ ] **Together:** Use a dedicated test identity and record the shared-account boundary. A user's Bots share their computer and permitted connectors; Bot names do not isolate credentials.
- [ ] **Together:** Verify fresh installation from any eventual listing and save the result.

**Done:** Verified Bot installation plus a confirmed publisher/listing route.
Consumer Grok, Grok Build, xAI API and Bot are not interchangeable evidence.
[Bot connection flow](https://docs.x.ai/grok-bot/computer-and-apps),
[team connector policy](https://docs.x.ai/grok-bot/teams-and-enterprises).

### Slack Marketplace — approval app

Portal: select the app in [Slack app management](https://api.slack.com/apps), then
Review and Submit.

On 2026-10-06, a source audit confirmed the legacy shared-token path and
missing uninstall/revocation handlers remain in main. A separate fix is pending;
it is not deployed.

On 2026-10-03, submission was disabled until public distribution is enabled.
The code still has a platform-wide `SANCTION_SLACK_BOT_TOKEN` fallback alongside
per-install OAuth delivery. Resolve its workspace-routing implications before
attesting that workspace-specific configuration has been removed.
[PR #347](https://github.com/ericlovold/sanction/pull/347) prepares public support
and privacy links plus the [reviewer packet](https://github.com/ericlovold/sanction/blob/4ddc411ec917b8ed193e8ff9cd6b6db30699b97b/docs/SLACK-SUBMISSION.md); it does not
enable distribution or establish adoption eligibility.

- [ ] **Eric:** Verify eligibility: at least ten active workspace installations maintained throughout review, and ten weekly active users. Active workspaces must have used the app within 28 days; sandbox installs do not count. Confirm live account counters before applying.
- [ ] **Together:** Prove public OAuth installation in an external workspace, correct owner/workspace routing, approval and rejection, and uninstall behavior.
- [ ] **Engineering:** Check OAuth state, authenticated Slack requests, token handling and HTTPS against the review requirements.
- [ ] **Engineering:** Publish Slack-specific setup/install guidance, listing screenshots, privacy disclosures and support reachable without a Sanction account.
- [ ] **Eric:** Commit to support responses within two business days and confirm the app's eligibility. Describe approval decisions separately from financial transactions or remote action execution.
- [ ] **Together:** Prepare populated Sanction reviewer credentials and instructions for Slack's reviewers to install into their own workspace. Do not provide a Slack workspace login as the test account.
- [ ] **Engineering:** Record the install → setup → approval/rejection → uninstall walkthrough; run automated checks and resolve findings.
- [ ] **Eric:** Add the required app collaborator to preserve configuration access, submit, and track review feedback. Verify the eventual listing with a fresh workspace install.

**Done:** Accepted listing and external-workspace lifecycle evidence. The install
threshold is an adoption gate; package preparation cannot satisfy it.
[Ten-workspace requirement](https://docs.slack.dev/changelog/2026/09/01/slack-marketplace-install-requirement/),
[distribution eligibility](https://docs.slack.dev/slack-marketplace/distributing-your-app-in-the-slack-marketplace/),
[app requirements](https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements/),
[review guide](https://docs.slack.dev/slack-marketplace/slack-marketplace-review-guide/).

### Slackbot MCP — separate from approval notifications

- [ ] **Engineering:** Configure the Slackbot MCP distribution path, including `mcp:connect`, the controlled HTTPS endpoint and supported authentication. Existing approval cards do not establish this integration.
- [ ] **Engineering + Eric:** If using OAuth, configure the provider/client and Slack's documented callback; keep its client secret in the appropriate secure configuration.
- [ ] **Together:** Install, fetch tools in app settings, verify titles/input schemas/read-only annotations, then prove discovery and invocation in Slackbot.
- [ ] **Engineering:** Add reviewer instructions covering install, authentication, invocation and expected outputs. For an MCP App UI, include at least one screenshot showing the tool inside a Slackbot conversation.
- [ ] **Eric:** Confirm the applicable distribution/review gates in the app's portal and submit only after this separate path passes.

**Done:** Recorded Slackbot tool discovery and approval lifecycle plus the
applicable distribution approval. [Slackbot MCP distribution requirements](https://docs.slack.dev/ai/slackbot-mcp-client/distributing/).

## Tool metadata rationale

Only `sanction_wallet_status` is marked read-only and idempotent. It reads scoped budget and approval counts. Authentication bookkeeping is incidental to the tool's operation.

| Tool group | Side effects reflected in annotations |
| --- | --- |
| Four `sanction_authorize*` tools | May consume grants, change authorization/budget state, and notify owners or webhooks. Marked destructive conservatively because existing authority can be spent; they do not themselves perform the requested purchase/tool/install. |
| `sanction_check_authorization` | Polling can settle an expired approval and mint a grant. Mutating, closed-world; timeout settlement does not invoke the human-resolution webhook path. |
| `sanction_log_tokens` | Adds metered usage and may send budget notifications. State-changing, conservatively destructive, open-world, not idempotent. |
| `sanction_log_outcome` | Adds an outcome inside Sanction; conservatively destructive because it changes recorded data. Optional dedupe key does not justify a blanket idempotency claim. |
| `sanction_request_execution` | Creates scoped authority. Conservatively destructive and closed-world; not read-only or retry-safe by annotation. |
| `sanction_inject_credential` | Retrieves a secret, adds an audit record, and can replace stored ciphertext during lazy key rotation. Destructive conservatively and closed-world; these hints do not imply that exposing the secret to a host is safe. |

Closed-world tools still call the Sanction API. The distinction concerns the resources and side effects involved, not whether a network request occurs.

## Common approval evidence checklist

Use the one-off approval cases in the [package guide](../packages/sanction-approvals/README.md) as the canonical OpenAI set. Keep prompts, setup, expected tools and observed results together. For other providers, these are Sanction's recommended test cases, not a claim that their portal mandates the same count.

- [ ] Request one synthetic approval; agent pauses without target execution.
- [ ] Check pending once; agent waits without polling or a new request.
- [ ] Approve; check, redeem the exact input once, and still execute no synthetic target.
- [ ] Explicit approval in observe mode still waits.
- [ ] Reject; agent stops without a replacement request.
- [ ] Changed arguments cannot reuse an approval.
- [ ] Hard policy denial remains a denial.
- [ ] Consumed authority cannot permit another action.

Also capture initial wallet-status discovery, fresh login, reconnect/refresh,
revocation, expiry and unavailable-server behavior per host. Test every exposed
tool with synthetic inputs. A backend pass, a connection check and a host's
compliance with pause/stop instructions are different pieces of evidence.

## Track submission through publication

For each provider, retain the artifact commit/version, submission ID/date,
review URL, account owner, reviewer-access expiry, open findings, approval date,
publication URL and a post-publication smoke result. Store credentials only in
the provider's secure form or the secrets store. Mark a row submitted only after
the portal confirms receipt; mark it published only after checking the listing.
