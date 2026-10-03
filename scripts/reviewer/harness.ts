import { randomUUID } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createSanctionMcpServer } from "../../lib/mcpServer"

export const SYNTHETIC_TOOL = "sanction.demo.approval"
export const CASE_IDS = ["positive_1", "positive_2", "positive_3", "positive_4", "positive_5", "negative_1", "negative_2", "negative_3"] as const
export type CaseId = typeof CASE_IDS[number]
export type FailureCode = "INVALID_TARGET" | "INVALID_TIMEOUT" | "REQUEST_FAILED" | "HTTP_ERROR" | "MALFORMED_RESPONSE" | "UNEXPECTED_DECISION" | "INTERNAL_ERROR"
export class ReviewerHarnessError extends Error {
  constructor(public readonly code: FailureCode) { super(code) }
}
export type DecisionEvidence = {
  authorized: boolean
  status: "approved" | "pending" | "escalated" | "denied"
  next_action: "proceed" | "wait" | "retry_with_grant" | "stop"
}
export type ReviewerEvidence = {
  evidence_scope: "backend_only"
  transport: "in_memory_mcp_to_rest"
  host: "unverified"
  oauth: "unverified"
  human: "unverified"
  owner_decisions: "scripted_management_api"
  target_execution: "never_invoked"
  fixtures_retained: true
  run_id: string
  fixture_names: string[]
  started_at: string
  finished_at: string
  overall: "passed" | "failed"
  failure_code?: FailureCode
  cases: Array<{ id: CaseId; status: "passed" | "failed" | "not_run"; decisions: DecisionEvidence[]; failure_code?: FailureCode }>
}
export type ReviewerOptions = { apiUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number }

/** URL locality does not establish database locality: run against a disposable
 * local server/database with outbound notifications disabled. No redirects.
 */
export function validateLoopbackApiUrl(input: string): string {
  let url: URL
  try { url = new URL(input) } catch { throw new ReviewerHarnessError("INVALID_TARGET") }
  if (!["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash ||
      !["/api/v1", "/api/v1/"].includes(url.pathname)) {
    throw new ReviewerHarnessError("INVALID_TARGET")
  }
  // Avoid resolving a configurable localhost hostname to a remote address.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1"
  url.pathname = "/api/v1"
  return url.toString().replace(/\/$/, "")
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReviewerHarnessError("MALFORMED_RESPONSE")
  return value as Record<string, unknown>
}
function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new ReviewerHarnessError("MALFORMED_RESPONSE")
  return value
}
function assert(condition: unknown, code: FailureCode = "UNEXPECTED_DECISION"): asserts condition {
  if (!condition) throw new ReviewerHarnessError(code)
}
function failureCode(error: unknown): FailureCode {
  return error instanceof ReviewerHarnessError ? error.code : "INTERNAL_ERROR"
}

type Decision = DecisionEvidence & { request_id?: string; grant_id?: string; code?: string; grant_status?: string }
type Fixture = { walletId: string; managementKey: string; client: Client; close: () => Promise<void>; lastFailure: () => FailureCode | undefined }

/** Keys, grant identifiers and raw backend messages never enter the report.
 * Abort on the first failed case; fixtures remain for inspection, never reset.
 */
export async function runReviewerEvidence(options: ReviewerOptions = {}): Promise<ReviewerEvidence> {
  const apiUrl = validateLoopbackApiUrl(options.apiUrl ?? "http://127.0.0.1:3000/api/v1")
  const timeoutMs = options.timeoutMs ?? 15_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new ReviewerHarnessError("INVALID_TIMEOUT")
  const fetchImpl = options.fetchImpl ?? fetch
  const report: ReviewerEvidence = {
    evidence_scope: "backend_only", transport: "in_memory_mcp_to_rest",
    host: "unverified", oauth: "unverified", human: "unverified",
    owner_decisions: "scripted_management_api", target_execution: "never_invoked", fixtures_retained: true,
    run_id: randomUUID(), fixture_names: [], started_at: new Date().toISOString(), finished_at: "",
    overall: "failed", cases: CASE_IDS.map(id => ({ id, status: "not_run", decisions: [] })),
  }
  const fixtures: Fixture[] = []
  let activeCase: ReviewerEvidence["cases"][number] | undefined
  async function request(path: string, method: "GET" | "POST" | "PATCH", auth?: { owner: string } | { agent: string }, body?: unknown, decision = false) {
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (auth && "owner" in auth) headers["x-mgmt-key"] = auth.owner
    if (auth && "agent" in auth) headers["x-api-key"] = auth.agent
    let response: Response
    let parsed: unknown
    try {
      response = await fetchImpl(`${apiUrl}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      })
      // The same abort signal bounds response-body consumption too.
      try { parsed = await response.json() } catch { throw new ReviewerHarnessError("MALFORMED_RESPONSE") }
    } catch (error) {
      throw error instanceof ReviewerHarnessError ? error : new ReviewerHarnessError("REQUEST_FAILED")
    }
    const result = record(parsed)
    const ordinaryDenial = decision && [403, 404, 409].includes(response.status) && result.authorized === false && result.status === "denied"
    if (!response.ok && !ordinaryDenial) throw new ReviewerHarnessError("HTTP_ERROR")
    if (result.error != null) throw new ReviewerHarnessError("HTTP_ERROR")
    return result
  }
  async function fixture(variant: "enforce" | "observe" | "blocked"): Promise<Fixture> {
    const name = `reviewer-${variant}-${report.run_id}`
    report.fixture_names.push(name) // Even an ambiguous create can be located by name.
    const wallet = await request("/wallets", "POST", undefined, { name, owner_email: `${variant}.${report.run_id}@example.invalid` })
    const walletId = requiredString(wallet.id)
    const managementKey = requiredString(wallet.management_key)
    assert(wallet.name === name && wallet.parent_id === null, "MALFORMED_RESPONSE")
    const policy = {
      enforcement_mode: variant === "observe" ? "observe" : "enforce",
      allowed_tools: [SYNTHETIC_TOOL], blocked_tools: variant === "blocked" ? [SYNTHETIC_TOOL] : [],
      escalate_tools: [], escalation_timeout_mins: 60, escalation_timeout_action: "deny",
    }
    const updated = await request("/wallets/policy", "PATCH", { owner: managementKey }, { wallet_id: walletId, ...policy })
    assert(updated.wallet_id === walletId, "MALFORMED_RESPONSE")
    const actualPolicy = record(updated.policy)
    for (const key of Object.keys(policy) as Array<keyof typeof policy>) {
      assert(JSON.stringify(actualPolicy[key]) === JSON.stringify(policy[key]), "MALFORMED_RESPONSE")
    }
    const agent = await request("/agents", "POST", { owner: managementKey }, { wallet_id: walletId, name: `reviewer-${variant}` })
    requiredString(agent.id)
    assert(agent.wallet_id === walletId && agent.name === `reviewer-${variant}`, "MALFORMED_RESPONSE")
    const apiKey = requiredString(agent.api_key)
    let lastError: FailureCode | undefined
    const server = createSanctionMcpServer({ apiKey, apiUrl, toolProfile: "approvals", apiCall: async (path, method, body) => {
      lastError = undefined
      try {
        assert((method === "POST" && path === "/authorize/tool") || (method === "GET" && /^\/authorize\/[^/]+$/.test(path)))
        return await request(path, method, { agent: apiKey }, body, true)
      } catch (error) { lastError = failureCode(error); throw new ReviewerHarnessError(lastError) }
    } })
    const client = new Client({ name: "sanction-reviewer-backend-evidence", version: "0.1.0" })
    const [a, b] = InMemoryTransport.createLinkedPair()
    const instance: Fixture = { walletId, managementKey, client, lastFailure: () => lastError,
      close: async () => { await client.close(); await server.close() } }
    fixtures.push(instance)
    await Promise.all([server.connect(b), client.connect(a)])
    return instance
  }
  async function invoke(f: Fixture, name: "sanction_authorize_tool" | "sanction_check_authorization", args: Record<string, unknown>): Promise<Decision> {
    const result = await f.client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs + 1000 })
    if (f.lastFailure()) throw new ReviewerHarnessError(f.lastFailure()!)
    assert(result.isError === false, "MALFORMED_RESPONSE")
    const decision = record(result.structuredContent)
    const content = result.content
    assert(Array.isArray(content) && content.length === 2, "MALFORMED_RESPONSE")
    const jsonBlock = record(content[1])
    assert(jsonBlock.type === "text" && typeof jsonBlock.text === "string", "MALFORMED_RESPONSE")
    let textDecision: unknown
    try { textDecision = JSON.parse(jsonBlock.text) } catch { throw new ReviewerHarnessError("MALFORMED_RESPONSE") }
    assert(JSON.stringify(textDecision) === JSON.stringify(decision), "MALFORMED_RESPONSE")
    assert(typeof decision.authorized === "boolean" &&
      ["approved", "pending", "escalated", "denied"].includes(String(decision.status)) &&
      ["proceed", "wait", "retry_with_grant", "stop"].includes(String(decision.next_action)), "MALFORMED_RESPONSE")
    const output = decision as Decision
    activeCase?.decisions.push({ authorized: output.authorized, status: output.status, next_action: output.next_action })
    return output
  }
  const input = { tool: SYNTHETIC_TOOL, arguments: { synthetic: true, execute: false }, require_approval: true, approval_reason: "Scripted backend-only synthetic reviewer test; execute nothing." }
  async function ask(f: Fixture) {
    const d = await invoke(f, "sanction_authorize_tool", input)
    assert(!d.authorized && d.status === "escalated" && d.next_action === "wait")
    return requiredString(d.request_id)
  }
  async function resolve(f: Fixture, requestId: string, approve: boolean) {
    const result = await request("/approvals", "POST", { owner: f.managementKey }, {
      wallet_id: f.walletId, request_id: requestId, decision: approve ? "approve" : "reject",
      note: "Scripted backend evidence; not a human or host acceptance test.",
    })
    assert(result.request_id === requestId && result.status === (approve ? "approved" : "denied"), "MALFORMED_RESPONSE")
    if (approve) requiredString(result.grant_id)
  }
  async function poll(f: Fixture, requestId: string) {
    const d = await invoke(f, "sanction_check_authorization", { request_id: requestId })
    assert(d.request_id === requestId && !d.authorized, "MALFORMED_RESPONSE")
    return d
  }
  async function run(id: CaseId, fn: () => Promise<void>) {
    activeCase = report.cases.find(c => c.id === id)!
    await fn()
    activeCase.status = "passed"
    activeCase = undefined
  }
  try {
    const enforced = await fixture("enforce")
    const observed = await fixture("observe")
    const blocked = await fixture("blocked")
    let firstRequest = ""
    await run("positive_1", async () => { firstRequest = await ask(enforced) })
    await run("positive_2", async () => {
      const d = await poll(enforced, firstRequest)
      assert(["pending", "escalated"].includes(d.status) && d.next_action === "wait" && d.grant_id === undefined)
    })
    await run("positive_3", async () => {
      await resolve(enforced, firstRequest, true)
      const d = await poll(enforced, firstRequest)
      assert(d.status === "approved" && d.next_action === "retry_with_grant")
      const grant = requiredString(d.grant_id)
      const redeemed = await invoke(enforced, "sanction_authorize_tool", { ...input, grant_id: grant })
      assert(redeemed.authorized && redeemed.status === "approved" && redeemed.next_action === "proceed" && redeemed.grant_status === "consumed")
    })
    await run("positive_4", async () => { await ask(observed) })
    await run("positive_5", async () => {
      const requestId = await ask(enforced)
      await resolve(enforced, requestId, false)
      const d = await poll(enforced, requestId)
      assert(d.status === "denied" && d.next_action === "stop" && d.grant_id === undefined)
    })
    await run("negative_1", async () => {
      const requestId = await ask(enforced)
      await resolve(enforced, requestId, true)
      const d = await poll(enforced, requestId)
      assert(d.status === "approved" && d.next_action === "retry_with_grant")
      const changed = await invoke(enforced, "sanction_authorize_tool", { ...input,
        arguments: { synthetic: true, execute: true }, grant_id: requiredString(d.grant_id) })
      assert(!changed.authorized && changed.status === "denied" && changed.next_action === "stop" && changed.code === "GRANT_MISMATCH")
    })
    await run("negative_2", async () => {
      const d = await invoke(blocked, "sanction_authorize_tool", input)
      assert(!d.authorized && d.status === "denied" && d.next_action === "stop" && d.code === "TOOL_BLOCKED")
    })
    await run("negative_3", async () => {
      const d = await poll(enforced, firstRequest)
      assert(d.status === "approved" && d.next_action === "stop" && d.grant_status === "consumed" && d.grant_id === undefined)
    })
    report.overall = "passed"
  } catch (error) {
    report.failure_code = failureCode(error)
    if (activeCase) { activeCase.status = "failed"; activeCase.failure_code = report.failure_code }
  } finally {
    for (const f of fixtures) {
      try { await f.close() } catch { report.overall = "failed"; report.failure_code ??= "INTERNAL_ERROR" }
    }
    report.finished_at = new Date().toISOString()
  }
  return report
}
