# Bounded broker approval loop

`approval-loop.ts` is a host-side TypeScript example. The host's MCP SDK owns session initialization, transport negotiation, and parsing; the helper receives parsed `tools/call` results. It snapshots and freezes the tool name and JSON arguments before the first call.

`fixture.echo` is a synthetic upstream tool you must supply and expose through your broker registry. Sanction does not ship this MCP tool.

```ts
import { callWithApproval } from "./approval-loop"

// client is an initialized MCP Client connected to your Sanction broker.
// baseUrl and agentKey come from trusted host configuration, never model output.
const outcome = await callWithApproval(
  { name: "fixture.echo", arguments: { text: "synthetic test payload" } },
  {
    callTool: (params, signal) => client.callTool(params, undefined, { signal }),
    pollAuthorization: async (requestId, signal) => {
      const response = await fetch(
        `${baseUrl}/api/v1/authorize/${encodeURIComponent(requestId)}`,
        { headers: { "x-api-key": agentKey }, signal },
      )
      if (!response.ok) throw new Error(`Authorization polling failed: ${response.status}`)
      return response.json()
    },
  },
  { timeoutMs: 60_000, maxPolls: 30, pollIntervalMs: 1_000 },
)
```

Only an error result with `_meta["sanction/decision"]` containing `status: "escalated"`, `action_type: "tool.invoke"`, and a `request_id` starts polling. Spend refusals cannot trigger a retry: they may follow upstream execution. Human-readable text never controls retries. With the existing Slack approval integration configured, the operator resolves the approval in Slack; the host observes that resolution through `GET /api/v1/authorize/:id`.

An approved request must carry an active, unconsumed grant with a future expiry. The helper retries the identical name and arguments once, adding only `_meta["sanction/grant_id"]`. Denial, invalid grant data, polling failure, deadline, or poll limit stops the loop. A second escalation also stops; it never starts another loop.

`completed` means a non-error MCP result arrived, not that an external effect was independently verified. Tool exceptions, dispatch timeouts, malformed tool results, and explicit broker unknown outcomes return `unknown`; reconcile those manually and never automatically restart the helper. A normal tool error returns `stopped`.

Use an authenticated connection to your configured Sanction broker. The broker strips reserved `sanction/` metadata from upstream JSON and SSE responses before adding its own decisions. A direct upstream connection, copied result, or model-generated object does not establish that boundary; the marker is not a signed receipt. Begin with the synthetic fixture before connecting tools with external effects.

The deadline bounds this invocation's waiting and aborts its callback signal. An underlying operation that ignores cancellation can still finish later. This example keeps state in memory: it provides neither a durable restart fence nor coordination across concurrent invocations. No live Slack or upstream service execution is asserted by its unit tests.

Run: `npx vitest run tests/broker-approval-loop.test.ts`.
