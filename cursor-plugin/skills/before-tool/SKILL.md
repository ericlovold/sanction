---
name: before-tool
description: Use this before invoking another MCP tool, a shell command, a deploy, or sending email. Call sanction_authorize_tool first; never invoke the target when it returns false.
---

# Before tool

The wallet is cooperative: this plugin does not intercept other MCP `tools/call`. Ask before you invoke.

## Steps

1. Name the exact tool about to run (`tool`, e.g. `github.create_deployment`, `shell.exec`, `email.send`). Include `server` and `arguments` when known — they surface on escalation.
2. Call `sanction_authorize_tool`. Do not invent extra tools.
3. If `authorized` is true, invoke the target once.
4. If `authorized` is false and status is not `escalated`, do not invoke.
5. If status is `escalated`, do not invoke. Follow **handle-escalation**, then retry this exact `sanction_authorize_tool` call with the returned `grant_id`.

Acquiring a new capability (installing a skill or plugin, enabling an integration, calling an API you have not used) is `sanction_authorize_capability`. Same rule: never acquire it on false.
