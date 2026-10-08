import { pathToFileURL } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { callWithApproval } from "./approval-loop"

export interface RunnerDependencies {
  createClient: () => Pick<Client, "connect" | "callTool" | "close">
  createTransport: (url: URL, options: ConstructorParameters<typeof StreamableHTTPClientTransport>[1]) => StreamableHTTPClientTransport
  fetch: typeof fetch
  log: (message: string) => void
}

const defaults: RunnerDependencies = {
  createClient: () => new Client({ name: "sanction-synthetic-approval-host", version: "1.0.0" }),
  createTransport: (url, options) => new StreamableHTTPClientTransport(url, options),
  fetch: (...args) => fetch(...args),
  log: message => console.log(message),
}

export function readRunnerConfig(env: Record<string, string | undefined>) {
  const raw = env.SANCTION_BASE_URL
  const agentKey = env.SANCTION_AGENT_KEY
  const upstream = env.SANCTION_BROKER_UPSTREAM
  if (!raw || !agentKey || !upstream) throw new Error("Missing runner configuration")
  const base = new URL(raw)
  const loopback = base.hostname === "localhost" || base.hostname === "127.0.0.1" || base.hostname === "[::1]"
  if ((base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) ||
      base.username || base.password || raw.includes("?") || raw.includes("#") ||
      base.pathname !== "/" || /[\r\n]/.test(agentKey) || !agentKey.trim() ||
      (upstream.length > 40 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(upstream))) {
    throw new Error("Invalid runner configuration")
  }
  return { base, agentKey, brokerUrl: new URL(`/mcp/broker/${upstream}`, base) }
}

/** Trusted environment only; the tool name and payload cannot be supplied by a model. */
export async function runSyntheticApproval(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<RunnerDependencies> = {},
): Promise<number> {
  const deps = { ...defaults, ...overrides }
  let client: ReturnType<RunnerDependencies["createClient"]> | undefined
  let transport: StreamableHTTPClientTransport | undefined
  let code = 1
  try {
    const { base, agentKey, brokerUrl } = readRunnerConfig(env)
    client = deps.createClient()
    transport = deps.createTransport(brokerUrl, {
      requestInit: { headers: { "x-api-key": agentKey }, redirect: "error" },
      // SDK SSE GET does not apply requestInit; enforce redirects at fetch too.
      fetch: (url, init) => deps.fetch(url, { ...init, redirect: "error" }),
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1_000, maxReconnectionDelay: 1_000, reconnectionDelayGrowFactor: 1 },
    })
    await client.connect(transport, { timeout: 15_000 })
    deps.log("Calling fixture.echo. Existing policy must escalate this tool; resolve its approval in Slack. Waiting up to five minutes.")
    const connected = client
    let reportedRequest = false
    const outcome = await callWithApproval(
      { name: "fixture.echo", arguments: { text: "synthetic test payload" } },
      {
        callTool: (params, signal) => connected.callTool(params, undefined, { signal, timeout: 300_000 }),
        pollAuthorization: async (requestId, signal) => {
          if (!reportedRequest) {
            // IDs are server data: bound and JSON-escape them rather than printing prose.
            deps.log(`Approval request ID: ${JSON.stringify(requestId.slice(0, 128)).replace(/[\u007f-\u009f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)}`)
            reportedRequest = true
          }
          const response = await deps.fetch(new URL(`/api/v1/authorize/${encodeURIComponent(requestId)}`, base), {
            headers: { "x-api-key": agentKey }, signal, redirect: "error", cache: "no-store",
          })
          if (!response.ok) throw new Error("Authorization polling failed")
          return response.json()
        },
      },
      { timeoutMs: 300_000, pollIntervalMs: 1_000, maxPolls: 300 },
    )
    if (outcome.status === "completed") {
      deps.log(outcome.retried
        ? "Completed after one approval retry. Verify the approval and audit trail separately; this does not prove Slack was used."
        : "Completed without an approval retry. This is not proof of the approval path; check the existing escalation policy.")
      code = outcome.retried ? 0 : 1
    } else {
      deps.log(outcome.status === "unknown"
        ? "Outcome unknown. Reconcile the audit trail manually before another invocation."
        : "Stopped without completion. Inspect the approval and audit trail before another invocation.")
    }
  } catch {
    // SDK exceptions can embed URLs, headers, or upstream text. Never print them.
    deps.log("Runner failed. Check trusted configuration and connectivity; reconcile any possible execution before another invocation.")
  } finally {
    // Close the transport explicitly even if SDK initialization failed before attaching it.
    try { await client?.close() } catch { code = 1; deps.log("Client cleanup failed.") }
    try { await transport?.close() } catch { code = 1; deps.log("Transport cleanup failed.") }
  }
  return code
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runSyntheticApproval().then(code => { process.exitCode = code })
}
