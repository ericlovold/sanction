# If you're not sure, Sanction it

Ask for one human approval from your AI tool. Review the exact proposed action,
then approve or deny it. You do not need to write a policy first. Existing hard
blocks still apply.

Sanction is free for individuals. Start with the harmless test below: it requests
permission and executes nothing. Connecting Sanction does not automatically
intercept the host's other tools.

## 1. Choose your host

Create your [Sanction account](/start) and an active agent first. OAuth connections
must use a verified social sign-in and a wallet you own or administer. Choose a
dedicated test agent when connecting; never paste an agent key into chat.

Use this **Streamable HTTP** URL for approval-focused OAuth connections:

```text
https://getsanction.com/mcp/approvals
```

This connection exposes eight existing tools and excludes execution-token
issuance and vault credential retrieval. It is a custom connection, not evidence
of a Sanction directory listing.

| Host | Setup | Sanction evidence as of October 2, 2026 |
| --- | --- | --- |
| Claude | Customize → Connectors → Add custom connector. Enter the URL above, choose automatic registration when offered, and complete Sanction consent. | Production synthetic request, approval, exact redemption and consumed-grant refusal observed October 1. No external action executed. |
| Cursor | Add the OAuth configuration below to your MCP settings and authenticate. | Configuration follows Cursor documentation; Sanction lifecycle test pending. |
| Codex | Add the HTTP server using the commands below, then sign in. | Configuration follows Codex documentation; Sanction lifecycle test pending. |
| Grok | [Connectors](https://grok.com/connectors) → New Connector → Custom. Enter the URL above and complete the offered authentication. | Grok documents custom MCP; Sanction authentication and lifecycle test pending. |
| ChatGPT | A remote MCP plugin is the distribution path. Sanction's package and review evidence are being prepared. | No verified public listing or completed ChatGPT lifecycle test. A local Codex connection does not install a ChatGPT web plugin. |

### Cursor

Merge this entry into your project `.cursor/mcp.json` or global
`~/.cursor/mcp.json`; preserve existing servers:

```json
{
  "mcpServers": {
    "sanction": {
      "url": "https://getsanction.com/mcp/approvals"
    }
  }
}
```

Use Cursor's authentication control when prompted. This config contains no key.
The separate Cursor marketplace scaffold has a different installation path and
is not a verified marketplace listing.

### Codex

```bash
codex mcp add sanction --url https://getsanction.com/mcp/approvals
codex mcp login sanction
```

Use an unused server name if `sanction` is already configured. Approve the intended
agent in Sanction, then restart or refresh the host's MCP connection as needed.
Local Codex clients share MCP configuration; ChatGPT web does not read it.

### Grok Bot, xAI API, and Slack

Grok consumer, Grok Bot, and the xAI API are separate connection paths. The
[Grok Bot guide](/docs/grok-bot) describes its marketplace and shared-account
boundaries; consumer custom-MCP support does not prove a Grok Bot listing.

Slack is where a person can receive and decide a request. [Configure Sanction
for Slack](/slack) separately; adding MCP to an AI host does not install the Slack
app. Use the email approval link if Slack delivery is not configured.

Official host references: [Claude](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp),
[Cursor](https://cursor.com/docs/mcp),
[Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
[Grok](https://docs.x.ai/grok/connectors),
[ChatGPT plugin submission](https://developers.openai.com/plugins/deploy/submission).
Host menus and account availability can change; these instructions were checked
October 2, 2026.

## 2. Check the connection

Ask your host:

> Call only `sanction_wallet_status` with empty arguments. Summarize the budget
> and pending-approval count. Do not create an authorization or display credentials.

A successful read proves the connection, not enforcement of other tools. If the
host cannot find Sanction or asks for authentication, fix that before proceeding.

## 3. Request your first approval

Copy this prompt into the connected host:

> Ask Sanction for my approval to run `demo.noop` with arguments
> `{"message":"My first approval"}`. Set `require_approval` to true and
> `approval_reason` to "I want to try a one-off approval." Make one
> `sanction_authorize_tool` call, show the request ID, then stop. This is a
> synthetic test: do not execute any action, retry, or poll automatically.

Expected: `authorized: false`, `status: escalated`, and `next_action: wait`.
A hard policy denial is also a valid result; it is not overridden by asking for
approval. Open the approval notification or your [approval inbox](/dashboard/approvals),
review the exact arguments, and approve or reject that test request.

If Claude's tool schema lacks `require_approval`, open the existing connector's
options and choose **Refresh tools list**, then retry discovery. This was needed
after the schema update in the October 1 smoke. Do not silently omit the flag.

## 4. Check once, then redeem exactly once

After you decide, ask the host to call `sanction_check_authorization` once with
the request ID. A denial means stop. Approval alone is not execution permission:
`next_action: retry_with_grant` means repeat the original authorization with the
same tool, server and arguments, plus the returned `grant_id`.

Only a redemption returning `authorized: true` permits that attempt. For this
synthetic test, execute nothing even after redemption. Never automatically
request fresh approval after a refusal, an ambiguous result, or a consumed grant.

Tool grants bind the reviewed arguments and expire. Redemption checks the grant;
it does not re-evaluate the current tool-policy ladder. [OAuth and decision
contract details](/docs/mcp-oauth) explain the boundary and remaining test gaps.

## Disconnect or get help

Disconnect a host at [MCP connections](/connect/mcp). This stops future requests;
it does not undo completed decisions or already admitted work.

Report setup problems through [Sanction support](mailto:eric@getsanction.com).
Include the host and failed step, but no keys, tokens, grants, or private action
arguments. For enforcement, route supported traffic through the
[MCP broker](/docs/agent-wallet); a cooperative connection cannot govern calls
that bypass it.
