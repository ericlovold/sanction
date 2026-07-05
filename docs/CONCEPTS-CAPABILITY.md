# Capability governance

An agent that installs a skill, adds a plugin, or reaches a new API has
**changed what it can do** — before it has done anything with the new power.
Most governance watches actions. Sanction also governs **acquisition**: new
capability is a governed action, exactly like spending money.

## The rule list

One ordered list on the wallet policy. Each rule is a namespaced pattern and
an effect:

```json
{
  "capability_rules": [
    { "pattern": "skill:install:crypto-*", "effect": "block" },
    { "pattern": "skill:install:*",        "effect": "escalate" },
    { "pattern": "api:github.com/*",       "effect": "allow" },
    { "pattern": "plugin:add:*",           "effect": "escalate" }
  ]
}
```

Patterns are prefix-globs over namespaced capability ids —
`skill:install:web-scraper`, `api:stripe.com/charges`, `plugin:add:browser`.
You invent the namespaces; Sanction enforces the list.

## Precedence

**Block → allow-list → escalate → allow.**

- A matching **block** rule denies, always. Deny overrides everything.
- If any **allow** rules exist, the list becomes an allow-list: a capability
  no rule mentions is denied. (An **escalate** pattern counts as a mention —
  escalate-listed capabilities reach the human instead of dying here.)
- A matching **escalate** rule routes to a human.
- No allow rules at all means governance is opt-in: block and escalate still
  apply, everything else passes.

## The same loop as money

`POST /v1/authorize/capability` answers **allowed**, **denied**, or
**escalated**. Allowed and denied are decision-only — nothing persists for a
routine yes. Escalations land in the same approval inbox as spend, carry the
same replayable evidence, and an approval mints the same one-use grant the
agent redeems with `grant_id`. One inbox, one grant mechanism, one audit
surface — whether the agent asked for $400 or for a new skill.

The AuthZEN wire speaks it too: send `resource.type: "capability"` to the
standard evaluation endpoint and the same ladder answers, with the standard
access-request offer on escalations.

## Why this matters

Skills are how agents grow. A spend limit cannot help you if the agent
quietly acquired the capability that routes around it — the tool that hits a
different payment rail, the plugin that exfiltrates before any purchase.
Governing acquisition means the blast radius of an agent is a policy
decision, not an emergent property.

## Where to go next

- [Authorization: the decision](/docs/authorization) — the shared lifecycle.
- [Evidence & replay](/docs/evidence-and-replay) — every escalation carries
  its proof.
