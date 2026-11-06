# ChatGPT and Codex — setup and disconnect

Use this guide for the OpenAI ChatGPT/Codex submission and for anyone
connecting those hosts. It describes what is shipped today. It is not
evidence of a published ChatGPT listing, a completed Codex lifecycle test,
or directory acceptance.

Sanction Approvals is a cooperative MCP connection. The host must ask
Sanction and honor the decision. Connecting does not intercept other tools,
install enforcement hooks, or execute the proposed action.

## Prerequisites

1. A [Sanction account](/start) with a **verified** sign-in (Google, GitHub,
   configured Apple, or a confirmed email magic link).
2. A wallet you own or administer, and an **active agent**. Create or choose
   the agent on Sanction's consent screen. Never paste an agent key into chat.
3. Management-key (`sk_`) login is **not** enough for OAuth consent. It can
   open the dashboard; it does not establish the human OAuth identity the
   host needs.

Create the account before adding the connector. OAuth cannot complete
against a wallet you do not administer.

## Which host are you installing?

ChatGPT web and the local Codex client are separate. A local Codex
connection does **not** install a ChatGPT web plugin.

| Host | What is shipped | What is not claimed |
| --- | --- | --- |
| Codex (local client) | Custom MCP URL + `codex mcp login` | Completed Sanction lifecycle test; a ChatGPT listing |
| ChatGPT (web) | Package candidate and this guide | A verified public listing or a working ChatGPT-web install path |

## Codex

```bash
codex mcp add sanction --url https://getsanction.com/mcp/approvals
codex mcp login sanction
```

Use another server name if `sanction` is already configured. Approve the
intended agent on Sanction's consent screen, then restart or refresh the
host's MCP connection if tools do not appear.

These commands follow Codex's documented MCP flow. Sanction has not
recorded a completed Codex approval-lifecycle test.

## ChatGPT

There is **no verified public ChatGPT listing** to install from. The
`packages/sanction-approvals` ZIP is an unpublished package candidate
(version 0.1.0, draft). When OpenAI publishes the listing, install it from
ChatGPT, complete Sanction OAuth, and select the review or production
agent on the consent screen.

Until that listing is public, do not tell users to "install Sanction from
ChatGPT." Point them at Codex or another documented host on
[Install](/install).

## Check the connection

In the connected host:

> Call only `sanction_wallet_status` with empty arguments. Summarize the
> budget and pending-approval count. Do not create an authorization or
> display credentials.

A successful read proves the connection, not enforcement of other tools.

Then try one synthetic approval from the [connection guide](/docs/connect).
The test executes nothing. A hard policy denial is a valid result.

## Disconnect

1. In Sanction, open [MCP connections](/connect/mcp) and disconnect the
   host. Future requests from that connection stop immediately.
2. In Codex, remove the server (`codex mcp` removal, or delete the entry
   from the local MCP config). In ChatGPT, remove or disable the plugin
   from ChatGPT's connector settings when the listing exists.
3. Disconnect does **not** undo completed decisions, revoke grants already
   redeemed, or roll back actions the host already took.

If the host still shows Sanction tools after disconnect, refresh or
restart it. Report leftover access to
[Sanction support](mailto:eric@getsanction.com) without including keys,
tokens, grants, or private action arguments.

## What connecting does not do

- It does not intercept ChatGPT or Codex tools that never call Sanction.
- It does not transfer funds, provision resources, or run the proposed action.
- It cannot retrieve vault credentials or issue execution tokens (those
  tools are absent from `/mcp/approvals`).
- A local Codex config is not a ChatGPT listing.

Privacy: [getsanction.com/privacy](https://getsanction.com/privacy).
Terms: [getsanction.com/terms](https://getsanction.com/terms).
Support: [getsanction.com/support](https://getsanction.com/support).
Install hub: [getsanction.com/install](https://getsanction.com/install).
