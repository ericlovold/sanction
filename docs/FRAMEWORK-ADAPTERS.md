# Framework adapters

Sanction stays outside the framework's identity system and inside the
pre-action path: the framework asks, Sanction decides, the agent acts only on an
approved decision or redeemed grant. The TypeScript adapters below **ship in
`@sanction/sdk`**; the Python recipes are copy-in until their packages land.

## TypeScript: `SanctionMiddleware` (ships)

Framework-agnostic — use it with LangChain.js, LangGraph, Mastra, or any custom
agent runtime. It authorizes first and runs the tool only on approval:

```ts
import { SanctionClient, SanctionMiddleware, SanctionToolBlocked } from "@sanction/sdk"

const client = new SanctionClient(process.env.SANCTION_AGENT_KEY!)
const runTool = SanctionMiddleware(client)

try {
  const result = await runTool({
    server: "github",
    tool: "create_pr",
    input: { title, body },
    run: () => octokit.pulls.create({ ... }), // runs ONLY if approved
  })
} catch (e) {
  if (e instanceof SanctionToolBlocked) {
    // e.status: "escalated" (poll e.requestId for the grant) | "denied" (replan)
  }
}
```

Prefer branching on the decision instead of catching? Use `authorizeToolCall`,
which returns `{ decision, run }` without throwing.

The invariant: `client.authorizeTool` fails **closed** — if Sanction is
unreachable it returns `denied`, so an ungoverned tool never runs.

## TypeScript: Vercel AI SDK (`sanctionTool`, ships)

Wrap an AI SDK tool so its `execute` is gated — the model can pick the tool, but
it only runs on an approved decision:

```ts
import { tool } from "ai"
import { z } from "zod"
import { SanctionClient, sanctionTool } from "@sanction/sdk"

const client = new SanctionClient(process.env.SANCTION_AGENT_KEY!)

const deploy = sanctionTool(client, "deploy", tool({
  description: "Deploy the app to an environment",
  parameters: z.object({ env: z.string() }),
  execute: async ({ env }) => shipIt(env),
}), { server: "ci" })
// pass `deploy` in your generateText/streamText `tools` map as usual
```

A non-approved decision throws `SanctionToolBlocked`, which the AI SDK surfaces
as a tool error the model can see and react to.

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
