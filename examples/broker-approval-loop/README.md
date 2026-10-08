# Bounded broker approval loop

`approval-loop.ts` is a host-side TypeScript example. The host's MCP SDK owns session initialization, transport negotiation, and parsing; the helper receives parsed `tools/call` results. It snapshots and freezes the tool name and JSON arguments before the first call.

`fixture.ts` supplies a synthetic `fixture.echo` upstream for this example. It only increments an in-memory counter; it sends no messages and performs no business action. Expose it through your broker registry before running the host.

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

## Runnable host and Slack acceptance test

This is a developer-operated test host, not a Claude, ChatGPT, or Grok connector.
It uses the installed MCP SDK and the same helper above. Its bounded REST polling
is deliberate host code; it does not change the approvals MCP's instructions to
wait for the owner before checking again.

### Prepare an isolated test path

1. Use a dedicated test wallet and agent. Configure `fixture.echo` in both
   `allowed_tools` and `escalate_tools`, with enforcement enabled and timeout
   set to deny. Ancestor restrictions still apply. Auto-approval is not a pass.
2. Install Sanction for Slack on that wallet and choose a private test channel
   containing only intended approvers. Confirm installation before starting.
   Requests create real audit records and may notify configured channels.
3. Run `fixture.ts` with a separately generated `SANCTION_FIXTURE_TOKEN` in its
   environment. For hosted Sanction, deploy the fixture behind reachable HTTPS;
   the broker's SSRF protection rejects loopback/private upstreams. Do not weaken
   that protection. Use one fixture process and no concurrent test runs: its
   counter resets on restart and is not durable evidence.
   `SANCTION_FIXTURE_HOST` defaults to `127.0.0.1` and
   `SANCTION_FIXTURE_PORT` to `4319`. A container deployment normally needs
   `SANCTION_FIXTURE_HOST=0.0.0.0` behind its HTTPS ingress; the bearer token
   remains required on both endpoints.
4. Register the fixture's `/mcp` URL with `POST /api/v1/broker/upstreams` using
   the wallet owner's management authentication. Set `name` to `slack-proof`,
   `auth_header` to `authorization`, and `auth_value` to `Bearer <fixture token>`.
   Supply the test wallet's `wallet_id`. Keep that token on the fixture and in
   Sanction's vaulted upstream configuration; never give it to the test agent.

From the repository root, after providing secrets privately through environment
variables (not command arguments or committed files):

```sh
# Fixture process. Hosted testing also needs an HTTPS deployment of this process.
npx tsx examples/broker-approval-loop/fixture.ts

# Separate host process; SANCTION_AGENT_KEY is the test agent's key.
SANCTION_BASE_URL=https://getsanction.com SANCTION_BROKER_UPSTREAM=slack-proof \
  npx tsx examples/broker-approval-loop/runner.ts
```

The runner uses the fixed call `fixture.echo` with
`{"text":"synthetic test payload"}`. Do not substitute a tool with external
effects. It waits for at most five minutes and retries the exact call once after
an active grant. It never automatically restarts. Treat lost responses as unknown
and reconcile before starting another run.

### Record the live proof

Use authenticated `GET /evidence` on the fixture to read its run identifier and
invocation count. Keep the bearer header out of screenshots and recordings.

| Step | Required observation |
| --- | --- |
| Before starting | Record fixture run identifier and baseline count. |
| Host pauses | A matching Slack card arrives; fixture count is unchanged. |
| Owner approves in Slack | Card matches the test agent/tool and approval reference; it reflects the decision. The expected arguments come from the fixed runner call. |
| Host resumes | Runner reports completion after approval; same fixture run's count rises by exactly one. |
| Separate denial run | Deny its matching card; runner stops and count is unchanged. |
| Separate timeout run | Leave pending; runner stops within its bound and count is unchanged. Resolve the outstanding request afterward. |

A successful tool response alone does not prove Slack was the approval source.
Current Slack cards summarize the action but do not display its exact arguments.
This controlled test uses known fixed inputs; it does not prove an operator can
inspect arbitrary arguments entirely inside Slack.
Save the Slack decision and corresponding authorization audit reference along
with the runner result, fixture counts, timestamp, host version, and Sanction
deployment revision. Redact all keys, grants, and private channel/member data.
If the fixture restarted, counts changed unexpectedly, or an outcome is unknown,
the run is inconclusive, not a pass.

Changed-argument and consumed-grant refusals are covered by the existing broker
tests and the [dashboard walkthrough](../../docs/BROKER-WALKTHROUGH.md). The runner
does not expose grants or add negative-test retries. Record that walkthrough
separately; do not label it as this host's live Slack proof.

Local tests do not verify Slack delivery, a production installation, or any
frontier host. Live acceptance evidence must be collected before those claims.
