# Framework adapters

Sanction stays outside the framework's identity system and inside the
pre-action path: the framework asks, Sanction decides, the agent acts only on an
approved decision or redeemed grant. The TypeScript adapters below **ship in
`sanction-sdk`** (`npm install sanction-sdk` — source in [`sdk/`](../sdk/)).
Python LiteLLM ships in `packages/sanction-python` (same `sanction-sdk` name,
PyPI publish pending). LangChain and CrewAI recipes stay copy-in.

## TypeScript: `SanctionMiddleware` (ships)

Framework-agnostic — use it with LangChain.js, LangGraph, Mastra, or any custom
agent runtime. It authorizes first and runs the tool only on approval:

```ts
import { SanctionClient, SanctionMiddleware, SanctionToolBlocked } from "sanction-sdk"

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
import { SanctionClient, sanctionTool } from "sanction-sdk"

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

Post-call meter, not a pre-call wall. `SanctionLiteLLMLogger` duck-types
LiteLLM's `CustomLogger` and posts each successful completion to
`POST /tokens`. The package does not import `litellm`.

```python
import os
import litellm
from sanction_sdk import SanctionLiteLLMLogger

litellm.callbacks = [
    SanctionLiteLLMLogger(api_key=os.environ["SANCTION_AGENT_KEY"])
]

response = litellm.completion(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
)
```

Cost comes from LiteLLM's `response_cost`. Missing usage is skipped, not
invented. A 402 or an unreachable Sanction never raises into the completion —
the call already happened.

For a fail-closed budget wall *before* the provider call, route LiteLLM's
provider base URL through `/api/gateway/<provider>` with `x-sanction-key`.

## Adapter checklist

- Fail closed on missing/invalid Sanction credentials.
- Treat `denied` as a normal planning outcome, not an exception to retry blindly.
- Treat `escalated` as a wait-for-grant state.
- Pass idempotency keys for retried actions.
- Store or link `request_id` so evidence can be replayed later.
- Keep provider keys in the runtime only until gateway vault-injected keys ship.
