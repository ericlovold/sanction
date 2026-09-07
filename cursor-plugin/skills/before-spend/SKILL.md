---
name: before-spend
description: Use this before any purchase, subscription, money transfer, or API credit top-up. Call sanction_authorize first; never proceed when it returns false; if status is escalated, wait and follow handle-escalation.
---

# Before spend

The wallet is cooperative: Sanction does not intercept the payment. Call it before the spend becomes irreversible.

## Steps

1. Gather `action` (`purchase` | `subscribe` | `transfer`), `amount_usd`, `merchant`, and `category` (`software`, `services`, `research`, `infrastructure`, `marketing`, `legal`, or `other`). Add `description` when a human may have to approve.
2. Call `sanction_authorize` with those fields. Do not invent extra tools.
3. If `authorized` is true, proceed with the spend.
4. If `authorized` is false and status is not `escalated`, stop. Do not retry with a different amount or merchant to dodge policy.
5. If status is `escalated`, do not spend. Keep the original fields and follow **handle-escalation**. After approval, retry this exact `sanction_authorize` call with the returned `grant_id`.

Provisioning seats, licenses, or infrastructure is a different call: `sanction_authorize_provision` (resource + dollars in one request). Same rule: never provision on false; escalations go through handle-escalation.
