# Connect Grok Bot to Sanction

Use Sanction’s hosted approvals MCP endpoint:

```text
https://getsanction.com/mcp/approvals
```

This guide describes a connection contract and a safe first check. It does not
claim a Sanction marketplace listing, a Connect-apps directory listing, or a
verified Grok Bot approval lifecycle. The [standalone plugin
repository](https://github.com/ericlovold/sanction-plugin) is public; this does
not establish a Grok Bot listing.

Consumer Grok documents a separate custom-MCP path at grok.com/connectors.
See [choose your host](/docs/connect) for that setup. Consumer Grok, Grok Bot,
and the xAI API are distinct surfaces; support in one does not prove Sanction
compatibility or marketplace acceptance in another.

As of 2026-10-06, consumer Grok's custom `/mcp/approvals` connection reaches
Sanction OAuth consent identifying Grok. With owner authorization, a dedicated
review agent was created and connected; OAuth returned to Grok with Sanction
Approvals shown as Connected and Added, with all eight tools visible and enabled.
One `sanction_wallet_status` call succeeded with zero pending approvals; no
authorization or write action was invoked. Approval lifecycle tests remain incomplete. Separately, the [Grok Build catalog
PR #1156](https://github.com/xai-org/plugin-marketplace/pull/1156) is open with
successful security checks and no reviews. Neither observation verifies Bot
compatibility. Track these distinct gates in the [submission checklist](MARKETPLACE-SUBMISSION.md).

## Check host support first

Official Grok Bot documentation still describes Connect apps → choose a catalog
plugin → Add → authenticate if requested → attach it in chat with `@`. That
page does not document an arbitrary custom MCP form. See [Grok’s computer and
apps guide](https://docs.x.ai/grok-bot/computer-and-apps) (checked 2026-10-22).

Cursor staff have documented an in-chat custom connector: tell the Bot to add
the public HTTPS URL, for example “Add this MCP server:
`https://getsanction.com/mcp/approvals`”. The Bot confirms the details. Localhost
and stdio servers are not reachable from the Bot’s cloud computer.

Grok Bot authenticates custom MCP over OAuth. There is no safe owner UI for
custom secret headers. Do not paste a `pxy_…` agent key into chat, saved skills,
URLs, or committed files, and never ask the Bot to display a key.

Where a host supports that custom remote MCP path:

| Setting | Value |
| --- | --- |
| Transport | Streamable HTTP |
| URL | `https://getsanction.com/mcp/approvals` |
| Auth | OAuth (no custom headers) |

Unauthenticated `POST /mcp/approvals` returns `401` with
`WWW-Authenticate` `resource_metadata` pointing at
`/.well-known/oauth-protected-resource/mcp/approvals` (checked against
production 2026-10-22). A Grok Bot session reached Sanction’s OAuth sign-in from
that URL with no custom headers. That is not completed consent, tool discovery,
or an approval-lifecycle proof.

If Sanction is unavailable in Connect apps and the Bot cannot add a public HTTPS
MCP URL, stop at that limitation rather than inventing an installation step or
editing `mcp.json`.

## Prepare a demo identity

Complete [wallet creation and owner-email verification](QUICKSTART.md#1-create-a-wallet)
before connecting. OAuth consent uses a verified Google, GitHub, or configured
Apple account, or an email sign-in link for an existing account. Management-key
login does not establish the human OAuth identity. Keep the owner’s `sk_…`
management key out of the Bot.

Use a dedicated demo agent and review its policy in the dashboard. Grok documents
account-wide connectors and a shared computer, including files, browser sessions,
and command-line credentials. A dedicated Sanction agent identifies the Sanction
identity that was selected at consent; it cannot prove which Grok Bot used a
shared connection. Bot names and separate screens do not establish credential
isolation. [Grok account boundaries](https://docs.x.ai/grok-bot/computer-and-apps).

## Run a read-only smoke test

After connecting, inspect the tool inventory. The approvals profile defines
eight tools and excludes execution-token issuance and vault credential
retrieval. A missing inventory or authentication error is a setup failure, not
evidence that governance is active.

Ask the Bot:

> Call only `sanction_wallet_status` with empty arguments. Report whether it succeeded and summarize the wallet’s budget usage and pending-approval count. Do not display credentials or call other tools.

Expected: a successful wallet status result, rather than `isError: true`. This
verifies the OAuth connection and a wallet read. It does not verify enforcement
of other connectors. `sanction_authorize` is state-changing; do not use it as a
connection test or assume it is a dry run. Do not perform real spend,
provisioning, credential injection, or token logging for this check.

For one synthetic approval after the smoke test, use the prompt in
[Connect](/docs/connect). Decision results put `authorized` and `next_action` in
the first text block. Honor `wait` (check once after the owner decides),
`retry_with_grant` (identical request plus `grant_id`), and `stop`. A Bot
approval lifecycle has not been verified on the record.

## Know what is enforced

`/mcp/approvals` is cooperative: the agent must ask Sanction before acting.
Connecting it does not intercept AWS, Zoom, shell commands, browser actions, or
every other tool. A skill that says “ask first” is not an enforcement boundary.

For intercepted MCP calls, an operator registers an upstream and routes the host
through `/mcp/broker/<name>`. Enforcement covers calls through that broker, not
direct connections or unrelated host tools. See [the agent wallet and broker
boundary](AGENT-WALLET.md). A Grok account-wide connection still carries the
shared-identity limit above.

The next Bot milestone is one synthetic `require_approval` request, a dashboard
decision, a single check, and exact grant redemption or stop. That host-specific
lifecycle still needs verification; the OAuth sign-in challenge and a
wallet-status check do not prove it.
