import { describe, it, expect } from "vitest"
import { SanctionClient } from "./client"
import { SanctionMiddleware, authorizeToolCall, sanctionTool, SanctionToolBlocked } from "./adapters"
import type { Fetch } from "./types"

function fakeFetch(responses: Array<{ ok: boolean; status: number; body: unknown }>): {
  fetch: Fetch
  calls: Array<{ url: string; init: RequestInit }>
} {
  const calls: Array<{ url: string; init: RequestInit }> = []
  let i = 0
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    const r = responses[i++] ?? { ok: true, status: 200, body: {} }
    return { ok: r.ok, status: r.status, text: async () => JSON.stringify(r.body) } as Response
  }) as unknown as Fetch
  return { fetch, calls }
}

const BASE = "https://api.test/v1"
const approved = { ok: true, status: 200, body: { authorized: true, status: "allowed", request_id: "req_1" } }
const escalated = { ok: true, status: 200, body: { authorized: false, status: "escalated", request_id: "req_2", code: "TOOL_ESCALATION_REQUIRED" } }
const denied = { ok: true, status: 403, body: { authorized: false, status: "denied", request_id: "req_3", code: "TOOL_BLOCKED", reason: "blocked" } }

describe("SanctionClient.authorizeTool", () => {
  it("normalizes the tool route's 'allowed' status to 'approved'", async () => {
    const { fetch, calls } = fakeFetch([approved])
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch })
    const d = await c.authorizeTool({ tool: "github.create_pr", server: "github", input: { title: "x" } })
    expect(d).toMatchObject({ authorized: true, status: "approved", requestId: "req_1" })
    expect(calls[0].url).toBe(`${BASE}/authorize/tool`)
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ tool: "github.create_pr", server: "github" })
  })

  it("returns denied/escalated as decisions, never throws", async () => {
    const c1 = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([denied]).fetch })
    expect((await c1.authorizeTool({ tool: "shell.exec" })).status).toBe("denied")
    const c2 = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([escalated]).fetch })
    expect((await c2.authorizeTool({ tool: "github.merge" })).status).toBe("escalated")
  })

  it("fails CLOSED (denied) when Sanction is unreachable — an ungoverned tool must not run", async () => {
    const fetch = (async () => { throw new Error("network down") }) as unknown as Fetch
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch })
    const d = await c.authorizeTool({ tool: "shell.exec" })
    expect(d).toMatchObject({ status: "denied", code: "POLICY_DENIED" })
  })

  it("surfaces 401 as an error (bad key, not a policy denial)", async () => {
    const c = new SanctionClient("pxy_bad", { baseUrl: BASE, fetch: fakeFetch([{ ok: false, status: 401, body: { error: "Invalid API key" } }]).fetch })
    await expect(c.authorizeTool({ tool: "x" })).rejects.toThrow(/Invalid API key/)
  })
})

describe("SanctionMiddleware", () => {
  it("runs the tool only on approval", async () => {
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([approved]).fetch })
    const runTool = SanctionMiddleware(c)
    let ran = false
    const out = await runTool({ tool: "deploy", server: "ci", run: () => { ran = true; return "shipped" } })
    expect(ran).toBe(true)
    expect(out).toBe("shipped")
  })

  it("throws SanctionToolBlocked and does NOT run the tool on denial", async () => {
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([denied]).fetch })
    const runTool = SanctionMiddleware(c)
    let ran = false
    await expect(runTool({ tool: "shell.exec", run: () => { ran = true } })).rejects.toBeInstanceOf(SanctionToolBlocked)
    expect(ran).toBe(false)
  })

  it("escalation carries the request id for grant polling", async () => {
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([escalated]).fetch })
    const runTool = SanctionMiddleware(c)
    await runTool({ tool: "github.merge", run: () => "no" }).catch((e: SanctionToolBlocked) => {
      expect(e.status).toBe("escalated")
      expect(e.requestId).toBe("req_2")
    })
  })
})

describe("authorizeToolCall (branch-not-throw)", () => {
  it("hands back the decision + a run thunk without executing", async () => {
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([denied]).fetch })
    let ran = false
    const { decision, run } = await authorizeToolCall(c, { tool: "shell.exec", run: () => { ran = true } })
    expect(decision.status).toBe("denied")
    expect(ran).toBe(false) // caller decides whether to run
    void run
  })
})

describe("sanctionTool (Vercel AI SDK)", () => {
  it("gates execute — runs on approval, throws on denial", async () => {
    const c1 = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([approved]).fetch })
    const t1 = sanctionTool(c1, "deploy", { description: "d", execute: async (a: unknown) => ({ ok: a }) }, { server: "ci" })
    expect(await t1.execute({ env: "prod" })).toEqual({ ok: { env: "prod" } })

    const c2 = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([denied]).fetch })
    let ran = false
    const t2 = sanctionTool(c2, "shell", { execute: async (_a: unknown) => { ran = true } })
    await expect(t2.execute({})).rejects.toBeInstanceOf(SanctionToolBlocked)
    expect(ran).toBe(false)
  })

  it("leaves a tool with no execute untouched", () => {
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch: fakeFetch([]).fetch })
    const t = sanctionTool(c, "noop", { description: "just a schema" } as { description: string; execute?: (a: unknown) => unknown })
    expect(t.execute).toBeUndefined()
  })

  it("redeems a grantId on retry after escalation", async () => {
    const { fetch, calls } = fakeFetch([approved])
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch })
    const t = sanctionTool(c, "deploy", { execute: async (_args: unknown) => "ok" }, { server: "ci", grantId: "grant_1" })
    expect(await t.execute({})).toBe("ok")
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ tool: "deploy", grant_id: "grant_1" })
  })
})

describe("SanctionClient.getAuthorization", () => {
  it("polls an escalated request and surfaces the grant when approved", async () => {
    const { fetch, calls } = fakeFetch([
      {
        ok: true,
        status: 200,
        body: {
          authorized: true,
          status: "approved",
          request_id: "req_2",
          grant_id: "grant_abc",
          grant_status: "active",
          agent: "tenet",
        },
      },
    ])
    const c = new SanctionClient("pxy_k", { baseUrl: BASE, fetch })
    const s = await c.getAuthorization("req_2")
    expect(s).toMatchObject({ status: "approved", requestId: "req_2", grantId: "grant_abc", grantStatus: "active" })
    expect(calls[0].url).toBe(`${BASE}/authorize/req_2`)
  })

  it("returns escalated while still waiting", async () => {
    const c = new SanctionClient("pxy_k", {
      baseUrl: BASE,
      fetch: fakeFetch([{ ok: true, status: 200, body: { authorized: false, status: "escalated", request_id: "req_2" } }]).fetch,
    })
    expect((await c.getAuthorization("req_2")).status).toBe("escalated")
  })
})
