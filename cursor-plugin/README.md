# Sanction

Independent authorization plane for AI agents. Before spend, an MCP tool, a credential, a provision, or a new capability becomes irreversible, the agent asks Sanction — approve, escalate to a human, or deny.

This directory is an unpublished Cursor plugin: a hosted MCP connection plus four skills. It does not establish a Cursor or Grok marketplace listing. For Grok Bot, see the [connection guide](https://github.com/ericlovold/sanction/blob/main/docs/GROK-BOT.md), including host support and shared-account limits.

For teams governing their own agents — budgets, tool policy, vaulted credentials — not only platforms embedding Sanction in a shipped product.

## Install

1. Complete the [wallet claim and agent setup](https://github.com/ericlovold/sanction/blob/main/docs/QUICKSTART.md#1-create-a-wallet) before connecting. First owner-email verification revokes pre-claim agent keys.
2. Install the scaffold [locally](#test-locally).
3. Set the plugin variable `SANCTION_AGENT_KEY` through Plugins → Configure, as described in [Cursor’s variables reference](https://cursor.com/docs/reference/plugins#variables). Use the `pxy_…` agent key, never a management key or a value pasted into chat.
4. Reload Cursor, inspect the ten tools, and call only `sanction_wallet_status` with `{}` for a read-only smoke test. `sanction_authorize` is not a dry run.

The plugin calls `https://getsanction.com/mcp` (Streamable HTTP) with `x-api-key`. Bearer also works on the hosted URL; this package leads with `x-api-key`.

## Ask for one human approval

After the read-only connection check, ask for a synthetic one-off decision:

> Call `sanction_authorize_tool` for `demo.noop` with server `demo`, arguments
> `{"message":"My first approval"}`, `require_approval: true`, and
> `approval_reason: "I want to try a one-off approval."` Make one request,
> show its request ID, then stop. Do not execute, retry, or poll automatically.

No policy edit is needed; hard denials still apply. After the owner decides, ask
Cursor to check that request once. On `next_action: retry_with_grant`, retry the
same authorization once with identical fields plus the returned `grant_id`.
Only `authorized: true` with `next_action: proceed` permits that attempt. This
synthetic test still executes nothing.

The skills read the machine decision, pause pending requests for human input,
and stop on denial, reused authority, errors or unknown outcomes. They do not
start fresh requests to evade those results. Approval binds the exact tool,
server and arguments; authorization and grant redemption do not execute the
target. A live Cursor test of this lifecycle remains pending.

## What the MCP exposes

Same ten tools as the hosted wallet. Do not invent others.

| Tool | What it does |
|------|----------------|
| `sanction_authorize` | Ask before purchase, subscribe, transfer, or API credit top-up. |
| `sanction_authorize_tool` | Ask before another MCP tool, shell, deploy, or email send. |
| `sanction_authorize_capability` | Ask before acquiring a new skill, plugin, integration, or API. |
| `sanction_authorize_provision` | Ask before provisioning seats, licenses, or infrastructure (resource + dollars). |
| `sanction_check_authorization` | Check a pending request once; return a usable one-use grant after approval. |
| `sanction_wallet_status` | Today / MTD spend and token totals, plus pending approvals. |
| `sanction_request_execution` | Mint a short-lived mandate (JWT) for a child agent or counterparty. |
| `sanction_inject_credential` | Retrieve a vaulted secret under that mandate (audit-logged). |
| `sanction_log_tokens` | Record LLM token usage against the token budget. |
| `sanction_log_outcome` | Record a confirmed business outcome (feeds cost-per-outcome ceilings). |

## Skills included

| Skill | When to use |
|-------|-------------|
| `before-spend` | Before purchase, subscribe, transfer, or API credit top-up. |
| `before-tool` | Before another tool or external action, including explicit one-off human approval. |
| `wallet-status` | Start of long or expensive work, or after a budget error. |
| `handle-escalation` | When authorization returns `next_action: wait`; check once, then pause for the human. |

v1 is MCP + skills only (portable Agent Orchestration connector). No rules, agents, commands, or hooks.

## Honest limits

This plugin wires the **cooperative** hosted wallet. The host must ask before acting. It does not intercept every MCP `tools/call`. Skipping the ask is not a bypass the engine can see.

For intercepted `tools/call`, register the upstream and point the host at the broker (`/mcp/broker/<name>`), not this plugin's wallet URL. See [The agent wallet](https://github.com/ericlovold/sanction/blob/main/docs/AGENT-WALLET.md).

## License

MIT for this package (`cursor-plugin/`). The parent product is [FSL-1.1-MIT](https://github.com/ericlovold/sanction/blob/main/LICENSE).

## Submit notes

The package was checked against [Cursor's plugin reference](https://cursor.com/docs/reference/plugins) on 2026-09-29. `mcp.json`, the relative logo path, and the four skill frontmatters use the documented layout. The required `SANCTION_AGENT_KEY` variable uses the supported string schema; Cursor does not document a `secret` schema keyword. No key value belongs in this package.

Before submission:

1. Complete the local check below and record the Cursor version, four discovered skills, ten tools, and successful read-only `sanction_wallet_status` result. Do not record the key.
2. With repository publication authorized, extract this directory's contents into a public MIT-only repository root, including `.cursor-plugin/`, `mcp.json`, `skills/`, `assets/`, README, and LICENSE. Update the manifest's `repository` URL and the LICENSE's parent-repository reference for that location. The current parent repository does not expose this nested package through a root marketplace manifest.
3. Submit that repository URL at [Cursor Marketplace publish](https://cursor.com/marketplace/publish). Confirm name availability during submission and use **Agent Orchestration** if the form offers that category. A [cursor.directory](https://cursor.directory) entry is separate from Cursor's review.

Remaining: a live Cursor install and authenticated smoke test, publication of the standalone package, and marketplace review. None is established by static package checks.

## Test locally

Copy the package into Cursor’s local plugin directory ([official instructions](https://cursor.com/docs/plugins#test-plugins-locally), checked 2026-09-29). From this repository root, with no existing local `sanction` plugin:

```bash
mkdir -p ~/.cursor/plugins/local
cp -R cursor-plugin ~/.cursor/plugins/local/sanction
```

Reload Window (Developer: Reload Window). Set `SANCTION_AGENT_KEY` in Plugins → Configure. Confirm the `sanction` MCP server and the four skills in Customize, then run the read-only smoke test in Install above. An installed marketplace plugin with the same name takes precedence over this local copy.

Cursor skips symlinks targeting directories outside `~/.cursor/plugins/local/`. On Teams/Enterprise, check Allow Local Plugin Imports under Dashboard → Settings → Security & Identity → Marketplace and Plugins. These are documented setup steps; this scaffold has not been verified in a live Cursor or Grok Bot session.
