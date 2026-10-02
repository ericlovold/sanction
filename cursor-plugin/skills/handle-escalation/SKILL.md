---
name: handle-escalation
description: Use when a Sanction authorization returns next_action wait. Check once, pause for human resolution, then redeem a usable grant against the original request before any action.
---

# Handle escalation

Pause the target action. Keep the original authorization tool, all its input fields, and the returned `request_id`. Do not start another request for the same action. Honor a user instruction to stop after requesting approval; perform no check until asked.

1. Call `sanction_check_authorization` once with that `request_id`. Read `authorized` and `next_action` from `structuredContent` or the JSON text block. A successful MCP call is not permission; this check always returns `authorized: false`.
2. On `next_action: wait`, report the pending request and wait for the human. Do not loop, schedule repeated checks, or retry authorization. After the human confirms resolution or explicitly asks for another check, check the same request once.
3. Only `next_action: retry_with_grant` with a `grant_id` permits a redemption attempt. Retry the original authorization tool once with identical fields plus that grant. For tool authorization, preserve the exact tool, server, arguments, `require_approval` and `approval_reason`. Do not treat status `approved` alone as authority.
4. Only redemption returning `authorized: true` and `next_action: proceed` permits the original target action once, within the user's request. Polling and redemption do not perform it. Synthetic tests execute no target action. Any other redemption result stops this flow, including another `wait`; do not begin a new escalation.
5. On `stop`, denial, consumed/expired/revoked/missing grant, mismatch, replay denial, any MCP/transport/authentication failure, or missing/contradictory fields, stop and report the result. Do not retry redemption, invent a new request, or re-escalate automatically. An unknown outcome requires reconciliation, not assumed permission.

Never change arguments to make a refused grant work. If the intended action changes, stop this flow and obtain explicit user direction before starting a separate authorization. If target execution has an unknown result, reconcile that result before considering another attempt; grant consumption is not proof the target succeeded.
