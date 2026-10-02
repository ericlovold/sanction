---
name: before-tool
description: Use before another MCP tool, shell command, deploy, or email send, including a one-off request for human approval. Request Sanction authorization before invoking the target.
---

# Before tool

The wallet is cooperative: this plugin does not intercept other MCP `tools/call`. Ask before invoking the target.

1. Prepare the exact `tool`, `server` when applicable, and complete `arguments` for the intended action. Resolve missing action details before requesting approval; do not obtain approval for placeholders and substitute real arguments later.
2. Call `sanction_authorize_tool`. For an explicit one-off human decision, include `require_approval: true` and a concise `approval_reason` (1–500 characters, no secrets). No policy edit is needed. This cannot override a hard denial and never auto-approves on timeout. Omit these fields for ordinary standing-policy authorization; confidence is not a reason to omit an approval the user requested.
3. Read `authorized` and `next_action` from `structuredContent`, or the JSON text block if the host exposes only text. `isError: false` and a readable success message do not establish permission.
4. Only `authorized: true` with `next_action: proceed` permits the exact target action once, within the user's request. A synthetic authorization test must still execute nothing. Authorization does not itself perform the action.
5. On `next_action: wait`, keep the original request and follow **handle-escalation**. On `stop`, an error, a missing/contradictory decision, or an unknown outcome, stop and report it. Do not invoke the target or issue a fresh authorization to work around refusal or uncertainty.

Approval binds the exact tool, server and arguments. Preserve every original field, including `require_approval` and `approval_reason`, for a grant retry; add only the returned `grant_id`.

Acquiring a new capability (a skill, plugin, integration, or API) uses `sanction_authorize_capability`. Do not pass the tool-only one-off fields to that tool. A separate required capability authorization must also succeed before acquisition.
