// Framework adapters — real, importable code that puts Sanction's tool gate in
// front of execution. The invariant every adapter preserves: the tool runs
// BEHIND the decision, never beside it in a log. Approved → run; escalated →
// wait for a grant; denied → don't run (a normal planning outcome, not a crash).
//
// These are framework-agnostic on purpose: they take a SanctionClient and a
// "run this tool" thunk. The framework-specific bindings (Vercel AI SDK below,
// LangChain/CrewAI/LiteLLM in their own modules) are thin shells over these.

import type { SanctionClient } from "./client"
import type { Decision, ToolDecision } from "./types"

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
  opts: { server?: string; grantId?: string } = {},
): T {
  const original = aiTool.execute
  if (typeof original !== "function") return aiTool
  const gated = async (args: unknown, options?: unknown) => {
    const decision = await client.authorizeTool({
      tool: name,
      server: opts.server,
      input: args,
      grantId: opts.grantId,
    })
    if (decision.status !== "approved") throw new SanctionToolBlocked(name, decision)
    return original(args, options)
  }
  return { ...aiTool, execute: gated }
}

// ── Pay-per-crawl (HTTP 402) ─────────────────────────────────────────────────
// Cloudflare's pay-per-crawl (and anything x402-shaped) turned the open web
// into a metered resource: a paid URL answers 402 with a `crawler-price`
// quote, and the crawler retries with a payment-intent header to be charged.
// The vendor answer to "what will my fleet pay?" is a static crawler-max-price
// header — a cap, not governance. This adapter makes the payment a governed
// spend decision instead: the quote runs through /authorize (merchant = the
// site, category = content-access), so auto-approve bands, per-domain history,
// daily/monthly/subtree budgets, escalation to a human, and the audit trail
// all apply — and the fetch only retries WITH payment intent behind an approve.
//
// Identity stays upstream (principle 1): Web Bot Auth signing belongs to the
// caller's fetch stack — pass your signing fetch as `baseFetch`, and note the
// payment header must be covered by your signature-input components.

/** Thrown when a paid fetch is not approved. Carries the quote + request id so
 *  the crawler can branch: escalated → poll the grant, denied → skip the URL. */
export class SanctionCrawlBlocked extends Error {
  readonly status: Decision["status"]
  readonly code?: Decision["code"]
  readonly requestId: string
  readonly url: string
  readonly priceUsd: number
  constructor(url: string, priceUsd: number, decision: Decision) {
    super(
      decision.status === "escalated"
        ? `Sanction escalation required to pay $${priceUsd} for ${url} — poll request ${decision.requestId} for the grant.`
        : `Sanction denied paying $${priceUsd} for ${url}: ${decision.code ?? decision.reason ?? "not authorized"}`,
    )
    this.name = "SanctionCrawlBlocked"
    this.status = decision.status
    this.code = decision.code
    this.requestId = decision.requestId
    this.url = url
    this.priceUsd = priceUsd
  }
}

/** Parse a `crawler-price` header ("USD 0.01"; tolerantly "$0.01" / "0.01").
 *  Returns dollars, or null when the value isn't a usable USD price — a 402
 *  without a parseable quote is NOT a pay-per-crawl offer and passes through. */
export function parseCrawlPrice(value: string | null | undefined): number | null {
  if (!value) return null
  const m = value.trim().match(/^(?:USD\s+|\$)?(\d+(?:\.\d+)?)$/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

export type SanctionedFetchOptions = {
  /** Spend category the quotes authorize under. Default "content-access". */
  category?: string
  /** Extra attribution tags merged over the defaults ({channel, url}). */
  tags?: Record<string, string>
  /** Observe every quote decision (metrics, logging). */
  onDecision?: (decision: Decision, url: string, priceUsd: number) => void
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/**
 * Wrap a fetch so HTTP 402 pay-per-crawl quotes are governed by Sanction.
 *
 * ```ts
 * const fetch = sanctionedFetch(client, signingFetch) // your Web Bot Auth fetch
 * const res = await fetch("https://example.com/article")
 * // free page → passes through untouched
 * // 402 + crawler-price → /authorize decides; approved → retried with
 * // crawler-exact-price (echoing the quote verbatim); else SanctionCrawlBlocked
 * ```
 *
 * Notes: the retry echoes the site's own `crawler-price` value into
 * `crawler-exact-price` (exact-match semantics — never a max). Requests with
 * one-shot stream bodies can't be retried; crawls are GETs in practice.
 */
export function sanctionedFetch(
  client: SanctionClient,
  baseFetch: FetchLike = fetch,
  opts: SanctionedFetchOptions = {},
): FetchLike {
  return async (input, init) => {
    const res = await baseFetch(input, init)
    if (res.status !== 402) return res

    const quote = res.headers.get("crawler-price")
    const priceUsd = parseCrawlPrice(quote)
    if (priceUsd === null) return res // 402 for some other reason — not ours to pay

    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    let host: string
    try {
      host = new URL(url).hostname
    } catch {
      return res // unparseable URL — refuse to authorize what we can't attribute
    }

    const decision = await client.authorize({
      action: "purchase",
      amountUsd: priceUsd,
      merchant: host,
      category: opts.category ?? "content-access",
      tags: { channel: "pay-per-crawl", url: url.slice(0, 80), ...opts.tags },
    })
    opts.onDecision?.(decision, url, priceUsd)
    if (decision.status !== "approved") throw new SanctionCrawlBlocked(url, priceUsd, decision)

    const headers = new Headers(init?.headers)
    headers.set("crawler-exact-price", quote as string)
    return baseFetch(input, { ...init, headers })
  }
}
