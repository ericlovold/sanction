---
name: handle-escalation
description: Use this when any sanction_authorize, sanction_authorize_tool, sanction_authorize_capability, or sanction_authorize_provision call returns status escalated. Poll sanction_check_authorization with request_id; on approved, retry the original call with grant_id; on denied, stop.
---

# Handle escalation

Escalation means a human must approve. Do not proceed, and do not start a different request for the same action.

## Steps

1. Keep the **original** authorize fields exactly (action/amount/merchant, tool name, capability, provision line, etc.) and the `request_id` from the escalated response.
2. Poll `sanction_check_authorization` with that `request_id`.
3. While status stays `escalated`, wait and poll again. Do not invoke, spend, provision, or acquire the capability.
4. When status is `approved` and a `grant_id` is returned, retry the **same** original tool (`sanction_authorize`, `sanction_authorize_tool`, `sanction_authorize_capability`, or `sanction_authorize_provision`) with identical fields plus that `grant_id`. A field mismatch is denied (`GRANT_MISMATCH`). The grant is one-use.
5. When status is denied (or the grant expires unused), stop. Do not proceed.

The wallet is cooperative: polling does not complete the action. Only a successful retry of the original authorize call does.
