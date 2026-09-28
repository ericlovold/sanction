# Sanction

Independent authorization plane for AI agents. Before spend, an MCP tool, a credential, a provision, or a new capability becomes irreversible, the agent asks Sanction — approve, escalate to a human, or deny.

This directory is an unpublished Cursor plugin scaffold: a hosted MCP connection plus four skills. It does not establish a Cursor or Grok marketplace listing. For Grok Bot, see the [connection guide](../docs/GROK-BOT.md), including host support and shared-account limits.

For teams governing their own agents — budgets, tool policy, vaulted credentials — not only platforms embedding Sanction in a shipped product.

## Install

1. Complete the [wallet claim and agent setup](../docs/QUICKSTART.md#1-create-a-wallet) before connecting. First owner-email verification revokes pre-claim agent keys.
2. Install the scaffold [locally](#test-locally).
3. Set the plugin variable `SANCTION_AGENT_KEY` through Plugins → Configure, as described in [Cursor’s variables reference](https://cursor.com/docs/reference/plugins#variables). Use the `pxy_…` agent key, never a management key or a value pasted into chat.
4. Reload Cursor, inspect the ten tools, and call only `sanction_wallet_status` with `{}` for a read-only smoke test. `sanction_authorize` is not a dry run.

The plugin calls `https://getsanction.com/mcp` (Streamable HTTP) with `x-api-key`. Bearer also works on the hosted URL; this package leads with `x-api-key`.

## What the MCP exposes

Same ten tools as the hosted wallet. Do not invent others.

| Tool | What it does |
|------|----------------|
| `sanction_authorize` | Ask before purchase, subscribe, transfer, or API credit top-up. |
| `sanction_authorize_tool` | Ask before another MCP tool, shell, deploy, or email send. |
| `sanction_authorize_capability` | Ask before acquiring a new skill, plugin, integration, or API. |
| `sanction_authorize_provision` | Ask before provisioning seats, licenses, or infrastructure (resource + dollars). |
| `sanction_check_authorization` | Poll an escalated request for its one-use grant. |
| `sanction_wallet_status` | Today / MTD spend and token totals, plus pending approvals. |
| `sanction_request_execution` | Mint a short-lived mandate (JWT) for a child agent or counterparty. |
| `sanction_inject_credential` | Retrieve a vaulted secret under that mandate (audit-logged). |
| `sanction_log_tokens` | Record LLM token usage against the token budget. |
| `sanction_log_outcome` | Record a confirmed business outcome (feeds cost-per-outcome ceilings). |

## Skills included

| Skill | When to use |
|-------|-------------|
| `before-spend` | Before purchase, subscribe, transfer, or API credit top-up. |
| `before-tool` | Before another MCP tool, shell, deploy, or email send. |
| `wallet-status` | Start of long or expensive work, or after a budget error. |
| `handle-escalation` | When any `authorize*` call returns `escalated`. |

v1 is MCP + skills only (portable Agent Orchestration connector). No rules, agents, commands, or hooks.

## Honest limits

This plugin wires the **cooperative** hosted wallet. The host must ask before acting. It does not intercept every MCP `tools/call`. Skipping the ask is not a bypass the engine can see.

For intercepted `tools/call`, register the upstream and point the host at the broker (`/mcp/broker/<name>`), not this plugin's wallet URL. See [The agent wallet](https://github.com/ericlovold/sanction/blob/main/docs/AGENT-WALLET.md).

## License

MIT for this package (`cursor-plugin/`). The parent product is [FSL-1.1-MIT](https://github.com/ericlovold/sanction/blob/main/LICENSE).

## Submit notes

Interim home in [ericlovold/sanction](https://github.com/ericlovold/sanction). Extract later to a public MIT-only repo, then submit at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish) and [cursor.directory](https://cursor.directory). Marketplace category: **Agent Orchestration**.

## Test locally

Copy the scaffold into Cursor’s local plugin directory ([official instructions](https://cursor.com/docs/plugins#test-plugins-locally), checked 2026-09-28). From this repository root, with no existing local `sanction` plugin:

```bash
mkdir -p ~/.cursor/plugins/local
cp -R cursor-plugin ~/.cursor/plugins/local/sanction
```

Reload Window (Developer: Reload Window). Set `SANCTION_AGENT_KEY` in Plugins → Configure. Confirm the `sanction` MCP server and the four skills in Customize.

Cursor skips symlinks targeting directories outside `~/.cursor/plugins/local/`. On Teams/Enterprise, check Allow Local Plugin Imports under Dashboard → Settings → Security & Identity → Marketplace and Plugins. These are documented setup steps; this scaffold has not been verified in a live Cursor or Grok Bot session.
