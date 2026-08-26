# Sanction + Vercel Connect — decide before the token is minted

> Verified 2026-08-26 against Vercel's own docs (`vercel.com/docs/connect`),
> not the launch post. Vercel Connect reached GA on 2026-08-25.

Vercel Connect removes the stored credential. Your app no longer keeps a
`SLACK_BOT_TOKEN`; it asks for one at runtime, proving who it is with the
deployment's OIDC identity, and gets back a short-lived scoped token:

```typescript
import { getToken } from '@vercel/connect'

const token = await getToken('slack/acme-slack', { subject: { type: 'app' } })
```

That is a real improvement, and it closes a problem Sanction never claimed to
solve. It also leaves one open.

## What Connect decides, and what it does not

Read the wire format for a token request (`POST /v1/connect/token/{connector}`):

```http
POST /v1/connect/token/slack%2Facme-slack HTTP/1.1
Authorization: Bearer <OIDC token>

{ "subject": { "type": "user", "id": "user_123" },
  "installationId": "inst_abc",
  "scopes": ["chat:write"] }
```

**The requested scopes come from the caller.** The agent says `chat:write`
and, if the connector permits it, a token is minted. Connect authenticates
the requester and issues a correctly-scoped, correctly-expiring credential.
It is an issuer.

What it does not ask is whether *this* agent, on *this* task, at *this* point
in its budget and escalation state, should be getting `chat:write` right now
— and it does not produce a record you can replay later to prove why the
answer was yes. That question is a policy decision, and it is a different
job from issuing the token.

An agent in a loop asking for a legitimate scope 4,000 times gets 4,000
correctly-scoped, correctly-expiring tokens.

## The composition

Put the decision in front of the mint. Sanction already models this: a
Connect token request is a **capability acquisition**, and
`POST /v1/authorize/capability` governs those against ordered, namespaced
rules — the same ladder that governs `skill:install:*` and `api:host/path`.

```typescript
import { getToken } from '@vercel/connect'

const CONNECTOR = 'slack/acme-slack'
const SCOPES = ['chat:write']

// 1. Ask Sanction first. Namespaced: connector:<connector>:<scope>
const decision = await fetch('https://getsanction.com/api/v1/authorize/capability', {
  method: 'POST',
  headers: { 'x-api-key': process.env.SANCTION_AGENT_KEY!, 'content-type': 'application/json' },
  body: JSON.stringify({ capability: `connector:${CONNECTOR}:${SCOPES.join(',')}` }),
}).then((r) => r.json())

// 2. Denied or escalated -> the token is never minted.
if (!decision.authorized) {
  throw new Error(`${decision.code}: ${decision.reason}`)
}

// 3. Approved -> Connect issues the short-lived, scoped credential.
const token = await getToken(CONNECTOR, { subject: { type: 'app' }, scopes: SCOPES })
```

On an escalation, `decision.status` is `escalated` and a human approves in the
dashboard or Slack; the approval mints a single-use `Grant` the agent replays
as `grant_id` on retry. Nothing is issued in the meantime.

## Policy recipe

Ordered `capabilityRules`, first match wins — the same shape as any other
capability policy:

```jsonc
{
  "capabilityRules": [
    // Read paths are routine.
    { "pattern": "connector:*:*:read",        "effect": "allow" },
    // Anything that writes into a human channel escalates.
    { "pattern": "connector:slack/*:chat:write", "effect": "escalate" },
    // Production data stores need a person, always.
    { "pattern": "connector:snowflake/*",     "effect": "escalate" },
    // Repository writes are allowed only for the review agent's subtree.
    { "pattern": "connector:github/*:contents:write", "effect": "deny" },
    { "pattern": "connector:*",               "effect": "deny" }
  ]
}
```

Because capability rules inherit down the wallet tree, a department wallet can
tighten what the org allows without re-stating it, and never loosen it.

## Honest boundary

**Connect owns the rail. Sanction owns the mandate.**

| | Vercel Connect | Sanction |
|---|---|---|
| Stores no long-lived secret | ✅ | — |
| Mints short-lived scoped tokens | ✅ | ✗ — never issues provider credentials |
| Authenticates the requester (OIDC) | ✅ | consumes it, never an identity of record |
| Decides whether this agent should get it now | ✗ | ✅ |
| Budget / rate / time-of-day conditions | ✗ | ✅ |
| Escalation to a human, with a single-use grant | ✗ | ✅ |
| Replayable decision record | connector activity logs | ✅ evidence + replay |

Sanction does not proxy, wrap, or replace `getToken`, and it never sees the
provider token. It answers one question before the call and records the answer.

Two things this composition does **not** do:

1. **It is not enforcement at the issuer.** An agent that skips the Sanction
   call still gets a token from Connect. This is cooperative governance, the
   same posture as the SDK and gateway paths — real for your own agents, not a
   containment boundary against hostile code. Enforcement at the issuer would
   need Connect to call a policy decision point before minting.
2. **It does not narrow the token.** Sanction decides yes or no on the scope
   the caller asked for; it cannot hand Connect a smaller scope than the code
   requested. Ask for the least scope you need — Connect's per-request
   `scopes` are what make the grant small, and Sanction's answer is what makes
   it accountable.

## Where the vault still applies

Sanction's credential vault (SEC-1 envelope encryption, per-wallet DEKs) is
for the credentials Connect does not cover: agents that do not run on Vercel
— a workstation agent, a Bedrock action group, an arbitrary MCP client — and
upstreams the MCP broker holds on an agent's behalf. Where Connect applies,
prefer it: a credential that never exists at rest beats one encrypted at rest.
