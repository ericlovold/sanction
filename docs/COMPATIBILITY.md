# Compatibility & badges

Sanction fits where agents already run. It is not another agent framework; it is
the authorization plane those frameworks can call before an agent spends money,
invokes a tool, touches a credential, provisions a resource, or burns through a
model budget.

## Badges

Use these claims when an integration actually routes through the named Sanction
surface:

| Badge | Use when | Proof surface |
|---|---|---|
| **Sanction-governed MCP** | An MCP host or server calls `sanction-mcp` before risky tools or spend | `npx sanction-mcp`, `/authorize/tool`, `/authorize` |
| **AuthZEN PDP compatible** | A policy enforcement point calls Sanction's OpenID AuthZEN endpoints | `/access/v1/evaluation`, `/access/v1/evaluations` |
| **AARP approval loop** | An AuthZEN escalation opens a Sanction access request and redeems the grant on retry | `/access/v1/access-request` |
| **Gateway metered** | Model calls route through the Sanction gateway with `x-sanction-key` | `/api/gateway/<provider>` |
| **Evidence replay ready** | Decisions persist policy revision + context and can replay the pure rules | `/authorize/{id}/evidence` |

## MCP hosts

The fastest channel is MCP because the install shape is already familiar:

```json
{
  "mcpServers": {
    "sanction": {
      "command": "npx",
      "args": ["sanction-mcp"],
      "env": {
        "SANCTION_API_KEY": "pxy_...",
        "SANCTION_WALLET_ID": "wal_..."
      }
    }
  }
}
```

Use the **MCP tool governance** policy pack when the first job is tool control:
read/search tools can pass, writes and shell commands escalate, delete/payment
tools deny.

## Frameworks

Framework integrations should keep their native developer experience and add one
pre-action check:

1. Route model calls through `/api/gateway/<provider>` when token budgets matter.
2. Call `/api/v1/authorize/tool` before tool invocations that can change state.
3. Call `/api/v1/authorize` before purchases or subscriptions.
4. On `escalated`, wait for the grant and retry with `grant_id`.
5. Link the resulting decision/evidence id into the framework's trace.

Start with the **Coding agent seat** pack for coding tools, or **Client-safe
launch** for agency-delivered agents.

## Gateways and proxies

If a team already uses LiteLLM, Portkey, Helicone, Envoy AI Gateway, Cloudflare
AI Gateway, or an internal proxy, Sanction does not need to replace it on day
one. Treat Sanction as the external policy authority:

- Meter directly through the Sanction gateway for the simplest pilot.
- Or keep the existing gateway and call Sanction's REST/AuthZEN endpoints before
  the gateway forwards risky actions.

Use the **Gateway token budget** pack for the first pilot: model calls are
metered with a hard daily token budget, while broader spend/tool governance can
come next.

## Payments and mandates

Payment standards such as AP2 and x402 are rails and mandate formats. Sanction's
role is policy and evidence before a rail is used: who authorized the agent, what
limits applied, which human approved the exception, and which grant was redeemed.

Use the **Payment agent mandate** pack when every money movement should escalate
and the evidence trail matters more than speed.
