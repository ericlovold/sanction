// Framework adapters — real, importable code that puts Sanction's tool gate in
// front of execution. The invariant every adapter preserves: the tool runs
// BEHIND the decision, never beside it in a log. Approved → run; escalated →
// wait for a grant; denied → don't run (a normal planning outcome, not a crash).
//
// These are framework-agnostic on purpose: they take a SanctionClient and a
// "run this tool" thunk. The framework-specific bindings (Vercel AI SDK below,
// LangChain/CrewAI/LiteLLM in their own modules) are thin shells over these.

import type { SanctionClient } from "./client"
import type { ToolDecision } from "./types"

/** Thrown when a tool call is not approved. Carries the machine code + request
 *  id so the agent can branch: escalated → poll the grant, denied → replan. */
export class SanctionToolBlocked extends Error {
  readonly status: ToolDecision["status"]
  readonly code?: ToolDecision["code"]
  readonly requestId: string
  constructor(tool: string, decision: ToolDecision) {
    super(
      decision.status === "escalated"
        ? `Sanction escalation required for '${tool}' — poll request ${decision.requestId} for the grant, then retry.`
        : `Sanction denied '${tool}': ${decision.code ?? decision.reason ?? "not authorized"}`,
    )
    this.name = "SanctionToolBlocked"
    this.status = decision.status
    this.code = decision.code
    this.requestId = decision.requestId
  }
}

export type SanctionedToolCall<T> = {
  tool: string
  server?: string
  input?: unknown
  /** Redeem a grant the owner minted when approving a prior escalation. */
  grantId?: string
  run: () => Promise<T> | T
}

/**
 * Wrap any agent runtime's tool execution. Returns a `runTool` you call in place
 * of executing the tool directly — it authorizes first and only runs on approval.
 *
 * ```ts
 * const runTool = SanctionMiddleware(client)
 * const result = await runTool({ server: "github", tool: "create_pr", input, run: () => octokit.pulls.create(...) })
 * ```
 *
 * On a non-approved decision it throws `SanctionToolBlocked` (carrying the code +
 * request id). Prefer this default — it makes "tool ran without approval"
 * unrepresentable. For agents that branch on decisions instead of exceptions,
 * use `authorizeToolCall` below.
 */
export function SanctionMiddleware(client: SanctionClient) {
  return async function runTool<T>(call: SanctionedToolCall<T>): Promise<T> {
    const { decision, run } = await authorizeToolCall(client, call)
    if (decision.status === "approved") return run()
    throw new SanctionToolBlocked(call.tool, decision)
  }
}

/**
 * Lower-level: authorize a tool call and hand back the decision + a `run` thunk,
 * without throwing. Use when the agent should branch on `decision.status`
 * (approved → run, escalated → wait for a grant, denied → replan) rather than
 * catch an exception.
 */
export async function authorizeToolCall<T>(
  client: SanctionClient,
  call: SanctionedToolCall<T>,
): Promise<{ decision: ToolDecision; run: () => Promise<T> }> {
  const decision = await client.authorizeTool({
    tool: call.tool,
    server: call.server,
    input: call.input,
    grantId: call.grantId,
  })
  return { decision, run: async () => call.run() }
}

// ── Vercel AI SDK ────────────────────────────────────────────────────────────
// The AI SDK's `tool()` takes an object with an `execute(args)` function. This
// wraps that object so `execute` is gated by authorizeTool: the model can pick
// the tool, but it only runs on an approved decision. Structural typing keeps
// the SDK a peer, not a hard dependency — no `ai` import here.

type AiSdkToolLike = {
  description?: string
  parameters?: unknown
  execute?: (args: unknown, options?: unknown) => Promise<unknown> | unknown
  [k: string]: unknown
}

/**
 * Gate a Vercel AI SDK tool through Sanction. Pass the tool name (Sanction's
 * governance key) and the AI SDK tool object; the returned tool is identical
 * except its `execute` authorizes first and runs only on approval.
 *
 * ```ts
 * import { tool } from "ai"
 * import { sanctionTool } from "@sanction/sdk"
 *
 * const deploy = sanctionTool(client, "deploy", tool({
 *   description: "Deploy the app",
 *   parameters: z.object({ env: z.string() }),
 *   execute: async ({ env }) => shipIt(env),
 * }), { server: "ci" })
 * ```
 *
 * A non-approved decision throws `SanctionToolBlocked`, which the AI SDK surfaces
 * as a tool error the model can see and react to.
 */
export function sanctionTool<T extends AiSdkToolLike>(
  client: SanctionClient,
  name: string,
  aiTool: T,
  opts: { server?: string } = {},
): T {
  const original = aiTool.execute
  if (typeof original !== "function") return aiTool
  const gated = async (args: unknown, options?: unknown) => {
    const decision = await client.authorizeTool({ tool: name, server: opts.server, input: args })
    if (decision.status !== "approved") throw new SanctionToolBlocked(name, decision)
    return original(args, options)
  }
  return { ...aiTool, execute: gated }
}
