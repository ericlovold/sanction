# Connect Grok Bot to Sanction

Sanction’s hosted wallet MCP endpoint is `https://getsanction.com/mcp`. This guide describes a connection contract and a safe first check; it does not claim a Sanction marketplace listing or verified Grok Bot compatibility. The [standalone plugin repository](https://github.com/ericlovold/sanction-plugin) is public; this does not establish a Grok Bot listing.

Consumer Grok now documents a separate custom-MCP path at grok.com/connectors.
See [choose your host](/docs/connect) for that candidate setup. Consumer Grok,
Grok Bot, and the xAI API are distinct surfaces; support in one does not prove
Sanction compatibility or marketplace acceptance in another.

As of 2026-10-06, consumer Grok's custom `/mcp/approvals` connection reaches
Sanction OAuth consent identifying Grok. With owner authorization, a dedicated
review agent was created and connected; OAuth returned to Grok with Sanction
Approvals shown as Connected and Added. Eight-tool discovery and approval
lifecycle tests remain incomplete. Separately, the [Grok Build catalog
PR #1156](https://github.com/xai-org/plugin-marketplace/pull/1156) is open with
successful security checks and no reviews. Neither observation verifies Bot
compatibility. Track these distinct gates in the [submission checklist](MARKETPLACE-SUBMISSION.md).

## Check host support first

Grok Bot’s documented connector flow is Marketplace → choose a plugin → Add → authenticate if requested → attach it in chat with `@`. Its documentation does not establish an arbitrary custom MCP import flow. If Sanction is unavailable and your host exposes no supported remote MCP configuration, stop at that limitation rather than inventing an installation step. See [Grok’s computer and apps guide](https://docs.x.ai/grok-bot/computer-and-apps) (checked 2026-09-28).

Where a host supports custom remote MCP, configure:

| Setting | Value |
| --- | --- |
| Transport | Streamable HTTP |
| URL | `https://getsanction.com/mcp` |
| Header | `x-api-key` |
| Secret value | Your `pxy_…` Sanction agent key |

Sanction also accepts `Authorization: Bearer <agent key>`. Use the host’s supported secret field or secret-variable binding; placeholder syntax varies by host. The Cursor scaffold binds `x-api-key` to `${SANCTION_AGENT_KEY}`. Do not assume Grok accepts that manifest or syntax. Do not put keys in chat, saved skills, URLs, or committed files, and never ask the Bot to display the key.

## Prepare a demo identity

Complete [wallet creation and owner-email verification](QUICKSTART.md#1-create-a-wallet) before creating the demo agent. The first verified owner-email claim revokes pre-claim agent keys and deactivates those agents; reconnect with a newly issued key afterward. Keep the owner’s `sk_…` management key out of the Bot connection.

Use a dedicated demo agent and review its policy in the dashboard. Grok documents account-wide connectors and a shared computer, including files, browser sessions, and command-line credentials. A dedicated Sanction key identifies the Sanction agent that presented it; it cannot prove which Grok Bot used a shared connection. Bot names and separate screens do not establish credential isolation. [Grok account boundaries](https://docs.x.ai/grok-bot/computer-and-apps).

## Run a read-only smoke test

After connecting, inspect the tool inventory. The hosted wallet defines ten tools, listed in the [plugin README](../cursor-plugin/README.md#what-the-mcp-exposes). A missing inventory or authentication error is a setup failure, not evidence that governance is active.

Ask the Bot:

> Call only `sanction_wallet_status` with empty arguments. Report whether it succeeded and summarize the wallet’s budget usage and pending-approval count. Do not display credentials or call other tools.

Expected: a successful wallet status result, rather than `isError: true`. This verifies credential acceptance and a wallet read. It does not verify enforcement of other connectors. `sanction_authorize` is state-changing; do not use it as a connection test or assume it is a dry run. Do not perform real spend, provisioning, credential injection, or token logging for this check.

## Know what is enforced

`/mcp` is cooperative: the agent must ask Sanction before acting. Connecting it does not intercept AWS, Zoom, shell commands, browser actions, or every other tool. A skill that says “ask first” is not an enforcement boundary.

For intercepted MCP calls, an operator registers an upstream and routes the host through `/mcp/broker/<name>`. Enforcement covers calls through that broker, not direct connections or unrelated host tools. See [the agent wallet and broker boundary](AGENT-WALLET.md). A Grok account-wide connection still carries the shared-identity limit above.

The next integration milestone is a harmless broker-routed tool call that pauses, reaches the owner in Slack, and resumes the exact approved request. That host-specific lifecycle still needs verification; the wallet-status check alone does not prove it.
