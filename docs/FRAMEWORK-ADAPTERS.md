# Framework adapters

These recipes are the adapter contracts we want ecosystem packages to preserve.
They keep Sanction outside the framework's identity system and inside the
pre-action path: the framework asks, Sanction decides, the agent acts only on an
approved decision or redeemed grant.

## TypeScript: `SanctionMiddleware`

Use this shape for LangChain.js, LangGraph, Mastra, Vercel AI SDK tool wrappers,
or any custom agent runtime:

```ts
import { SanctionClient } from "@sanction/sdk"

type ToolCall = {
  server: string
  tool: string
  input?: unknown
  run: () => Promise<unknown>
}

export function SanctionMiddleware(client: SanctionClient) {
  return async function runTool(call: ToolCall) {
    const decision = await client.authorizeTool({
      server: call.server,
      tool: call.tool,
      input: call.input,
    })

    if (decision.status === "approved") return call.run()
    if (decision.status === "escalated") {
      throw new Error(`Sanction escalation required: ${decision.requestId}`)
    }
    throw new Error(`Sanction denied ${call.tool}: ${decision.code ?? decision.reason}`)
  }
}
```

The concrete package still needs SDK support for `authorizeTool`; until then,
call `POST /api/v1/authorize/tool` directly with the agent key. The important
adapter invariant is stable: tool execution is behind the decision, not beside
it in a log.

## Python: LangChain / LangGraph callback

Wrap tool execution in a callback or runnable decorator:

```python
import os
import httpx

SANCTION_API = os.getenv("SANCTION_API", "https://getsanction.com/api/v1")
SANCTION_KEY = os.environ["SANCTION_AGENT_KEY"]

def authorize_tool(server: str, tool: str, payload: dict | None = None) -> dict:
    res = httpx.post(
        f"{SANCTION_API}/authorize/tool",
        headers={"x-api-key": SANCTION_KEY},
        json={"server": server, "tool": tool, "input": payload or {}},
        timeout=10,
    )
    res.raise_for_status()
    return res.json()

def sanctioned_tool(server: str, tool: str, fn):
    def wrapper(*args, **kwargs):
        decision = authorize_tool(server, tool, {"args": args, "kwargs": kwargs})
        if decision["status"] == "approved":
            return fn(*args, **kwargs)
        if decision["status"] == "escalated":
            raise RuntimeError(f"Sanction escalation required: {decision['request_id']}")
        raise RuntimeError(f"Sanction denied {tool}: {decision.get('code') or decision.get('reason')}")
    return wrapper
```

Use the same pattern for spend (`/authorize`), provisioning
(`/authorize/provision`), and capability acquisition (`/authorize/capability`).

## LiteLLM callback

For token spend, the simplest path is still the gateway base URL. If LiteLLM is
already the gateway of record, add a callback that logs usage and uses Sanction
as the budget authority for high-risk operations:

```python
import os
import httpx

SANCTION_API = os.getenv("SANCTION_API", "https://getsanction.com/api/v1")
SANCTION_KEY = os.environ["SANCTION_AGENT_KEY"]

def log_tokens(model: str, tokens_in: int, tokens_out: int, cost_usd: float, task: str):
    httpx.post(
        f"{SANCTION_API}/tokens",
        headers={"x-api-key": SANCTION_KEY},
        json={
            "model": model,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd,
            "task": task,
        },
        timeout=10,
    ).raise_for_status()
```

For a fail-closed budget wall before the provider call, route LiteLLM's provider
base URL through `/api/gateway/<provider>` with `x-sanction-key`. Manual
`/tokens` logging is useful for parity and reporting; it is not a pre-call wall.

## Adapter checklist

- Fail closed on missing/invalid Sanction credentials.
- Treat `denied` as a normal planning outcome, not an exception to retry blindly.
- Treat `escalated` as a wait-for-grant state.
- Pass idempotency keys for retried actions.
- Store or link `request_id` so evidence can be replayed later.
- Keep provider keys in the runtime only until gateway vault-injected keys ship.
