import { afterEach, describe, expect, it, vi } from "vitest"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { costPerOutcomeRule, type SpendContext } from "@/lib/rules/spend"
import {
  ensureCpoArmed,
  gapSpends,
  parseCpoSummary,
  planCpoArm,
  wouldCpoEscalate,
  type CpoWindow,
} from "../scripts/demo/cpoArm"
import { coastline } from "../scripts/demo/personas/coastline"
import { meridian } from "../scripts/demo/personas/meridian"
import type { Keys } from "../scripts/demo/lib"

const ATLAS = "Demo — Coastline / Client — Atlas D2C"
const BLUEBIRD = "Demo — Coastline / Client — Bluebird Health"
const CORSAIR = "Demo — Coastline / Client — Corsair Gaming"
const CHARGE = 12
const PRIME_AMOUNTS = [48, 48, 48, 48]
const ARM_OPTS = { autoApproveUnderUsd: 50, primeSpendAmounts: PRIME_AMOUNTS }

const bluebird: CpoWindow = { windowSpendUsd: 0, windowOutcomes: 0, minOutcomes: 3, ceilingUsd: 60 }

function ruleEscalates(window: CpoWindow, chargeUsd: number): boolean {
  const ctx: SpendContext = {
    amountUsd: chargeUsd,
    amountCents: Math.round(chargeUsd * 100),
    category: "marketing",
    blockedCategories: [],
    allowedCategories: ["marketing"],
    perTxnMaxCents: 50_000,
    dailySpentUsd: 0,
    dailyBudgetCents: 40_000,
    monthlySpentUsd: 0,
    monthlyBudgetCents: null,
    autoApproveUnderCents: 5_000,
    escalateOverCents: 20_000,
    cpo: {
      ceilingCents: Math.round(window.ceilingUsd * 100),
      windowSpendUsd: window.windowSpendUsd,
      windowOutcomes: window.windowOutcomes,
      minOutcomes: window.minOutcomes,
    },
  }
  return costPerOutcomeRule.run(ctx).effect === "escalate"
}

function coastlineKeys(): Keys {
  return {
    company: { walletId: "coastline", mgmtKey: "sk_company" },
    pools: {
      [ATLAS]: { walletId: "atlas", mgmtKey: "sk_atlas" },
      [BLUEBIRD]: { walletId: "bluebird", mgmtKey: "sk_bluebird" },
      [CORSAIR]: { walletId: "corsair", mgmtKey: "sk_corsair" },
    },
    seats: {
      "atlas-outreach-agent": { agentId: "atlas-outreach", apiKey: "pxy_ao", poolName: ATLAS },
      "atlas-media-agent": { agentId: "atlas-media", apiKey: "pxy_am", poolName: ATLAS },
      "bluebird-media-agent": { agentId: "bluebird-media", apiKey: "pxy_bm", poolName: BLUEBIRD },
      "corsair-media-agent": { agentId: "corsair-media", apiKey: "pxy_cm", poolName: CORSAIR },
    },
    pending: [],
  }
}

describe("Coastline Bluebird CPO probe", () => {
  it("still expects the $12 Google Ads spend to escalate", () => {
    const probe = coastline.pulse.spends.find((s) => s.seat === "bluebird-media-agent")
    expect(probe).toMatchObject({ amount_usd: 12, merchant: "Google Ads", expect: "escalated", then: "leave-pending" })
    expect(coastline.prime?.outcomes.map((o) => o.days_ago).sort((a, b) => a - b)).toEqual([1, 3, 5])
    expect(coastline.prime?.spends.reduce((sum, s) => sum + s.amount_usd, 0)).toBe(192)
  })
})

describe("wouldCpoEscalate", () => {
  it.each([
    [{ ...bluebird }, 12, false],
    [{ ...bluebird, windowOutcomes: 2, windowSpendUsd: 1000 }, 12, false],
    [{ ...bluebird, windowOutcomes: 3, windowSpendUsd: 168 }, 12, false],
    [{ ...bluebird, windowOutcomes: 3, windowSpendUsd: 168.01 }, 12, true],
    [{ ...bluebird, windowOutcomes: 3, windowSpendUsd: 192 }, 12, true],
  ] as const)("%j charge $%s → %s", (window, charge, expected) => {
    expect(wouldCpoEscalate(window, charge)).toBe(expected)
    expect(wouldCpoEscalate(window, charge)).toBe(ruleEscalates(window, charge))
  })
})

describe("planCpoArm", () => {
  it("skips writes when the probe would already escalate", () => {
    expect(planCpoArm({ ...bluebird, windowOutcomes: 3, windowSpendUsd: 192 }, CHARGE, ARM_OPTS)).toEqual({
      kind: "already_armed",
    })
  })

  it("re-posts prime spend + min outcomes on a fully aged-out window", () => {
    expect(planCpoArm(bluebird, CHARGE, ARM_OPTS)).toEqual({
      kind: "arm",
      spendAmounts: PRIME_AMOUNTS,
      outcomeCount: 3,
    })
    const armed: CpoWindow = { ...bluebird, windowSpendUsd: 192, windowOutcomes: 3 }
    expect(wouldCpoEscalate(armed, CHARGE)).toBe(true)
  })

  it("adds only the missing outcomes when leftover spend already covers the ceiling", () => {
    expect(planCpoArm({ ...bluebird, windowOutcomes: 2, windowSpendUsd: 192 }, CHARGE, ARM_OPTS)).toEqual({
      kind: "arm",
      spendAmounts: [],
      outcomeCount: 1,
    })
  })

  it("does not add outcomes that would dilute a governed window", () => {
    const plan = planCpoArm({ ...bluebird, windowOutcomes: 3, windowSpendUsd: 0 }, CHARGE, ARM_OPTS)
    expect(plan.kind).toBe("arm")
    if (plan.kind !== "arm") return
    expect(plan.outcomeCount).toBe(0)
    expect(plan.spendAmounts.length).toBeGreaterThan(0)
    const next: CpoWindow = {
      ...bluebird,
      windowOutcomes: 3,
      windowSpendUsd: plan.spendAmounts.reduce((a, b) => a + b, 0),
    }
    expect(wouldCpoEscalate(next, CHARGE)).toBe(true)
  })
})

describe("gapSpends", () => {
  it("lands approved spend so the $12 probe is the tipping charge", () => {
    const chunks = gapSpends({ ...bluebird, windowOutcomes: 3, windowSpendUsd: 0 }, CHARGE, 50)
    expect(chunks).not.toBeNull()
    const total = chunks!.reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(168.01, 2)
    expect(Math.max(...chunks!)).toBeLessThanOrEqual(50)
    expect(wouldCpoEscalate({ ...bluebird, windowOutcomes: 3, windowSpendUsd: total }, CHARGE)).toBe(true)
  })
})

describe("parseCpoSummary", () => {
  const ok = {
    wallet_id: "bluebird",
    outcomes: 3,
    window_spend_usd: 192,
    ceiling_usd: 60,
    governed: true,
  }
  it("reads a well-formed owner summary", () => {
    expect(parseCpoSummary(ok, "bluebird")).toEqual({
      outcomes: 3,
      windowSpendUsd: 192,
      ceilingUsd: 60,
      governed: true,
    })
  })
  it.each([null, {}, { ...ok, wallet_id: "other" }, { ...ok, outcomes: 1.5 }, { ...ok, window_spend_usd: -1 }])(
    "fails closed on %j",
    (body) => {
      expect(typeof parseCpoSummary(body, "bluebird")).toBe("string")
    },
  )
})

describe("ensureCpoArmed", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("does not touch the API for personas without a prime plan", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    expect(await ensureCpoArmed(meridian, { pools: {}, seats: {}, pending: [] })).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("writes nothing when the live window already trips the $12 probe", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          wallet_id: "bluebird",
          outcomes: 3,
          window_spend_usd: 192,
          ceiling_usd: 60,
          governed: true,
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)
    expect(await ensureCpoArmed(coastline, coastlineKeys())).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/outcomes?"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "x-mgmt-key": "sk_bluebird" }),
      }),
    )
  })

  it("arms an empty window with date-scoped outcomes relative to now, then verifies", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    const now = () => new Date("2026-10-30T12:00:00Z")
    let spend = 0
    let outcomes = 0
    const posts: { path: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url, "http://localhost").pathname
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
        if (path.endsWith("/outcomes") && (init?.method ?? "GET") === "GET") {
          return new Response(
            JSON.stringify({
              wallet_id: "bluebird",
              outcomes,
              window_spend_usd: spend,
              ceiling_usd: 60,
              governed: outcomes >= 3,
            }),
            { status: 200 },
          )
        }
        posts.push({ path, body })
        if (path.endsWith("/authorize")) {
          spend += Number(body.amount_usd)
          return new Response(JSON.stringify({ status: "approved" }), { status: 200 })
        }
        if (path.endsWith("/outcomes")) {
          outcomes += 1
          return new Response(JSON.stringify({ recorded: true }), { status: 201 })
        }
        return new Response(JSON.stringify({ error: path }), { status: 500 })
      }),
    )
    expect(await ensureCpoArmed(coastline, coastlineKeys(), now)).toEqual([])
    expect(spend).toBe(192)
    expect(outcomes).toBe(3)
    const outcomePosts = posts.filter((p) => p.path.endsWith("/outcomes"))
    expect(outcomePosts.map((p) => p.body.dedupe_key)).toEqual([
      "bluebird-booking-p1-2026-10-30",
      "bluebird-booking-p3-2026-10-30",
      "bluebird-booking-p5-2026-10-30",
    ])
    expect(outcomePosts.map((p) => p.body.occurred_at)).toEqual([
      new Date("2026-10-29T12:00:00Z").toISOString(),
      new Date("2026-10-27T12:00:00Z").toISOString(),
      new Date("2026-10-25T12:00:00Z").toISOString(),
    ])
  })

  it("fails closed when the owner summary is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 401 })))
    const errors = await ensureCpoArmed(coastline, coastlineKeys())
    expect(errors[0]).toContain("HTTP 401")
  })
})

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}))
  })
}

describe("pulse CLI re-arms Bluebird before asserting escalate", () => {
  async function pulseAgainst(initial: { spend: number; outcomes: number }) {
    const requests: string[] = []
    let spend = initial.spend
    let outcomes = initial.outcomes
    const google: number[] = []
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://localhost")
      const path = url.pathname.replace(/^\/api\/v1/, "")
      const body = req.method === "GET" ? {} : await readBody(req)
      requests.push(`${req.method} ${path}`)
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" })
        res.end(JSON.stringify(payload))
      }
      if (path === "/reporting/summary" && req.method === "GET") {
        const walletId = url.searchParams.get("wallet_id")
        const date = url.searchParams.get("from")
        const seats =
          walletId === "atlas"
            ? [
                { agent_id: "atlas-outreach", token_cost_usd: 0 },
                { agent_id: "atlas-media", token_cost_usd: 0 },
              ]
            : [{ agent_id: "bluebird-media", token_cost_usd: 0 }]
        return json(200, { wallet_id: walletId, scope: "wallet", from: date, to: date, by_agent: seats })
      }
      if (path === "/outcomes" && req.method === "GET") {
        return json(200, {
          wallet_id: url.searchParams.get("wallet_id"),
          outcomes,
          window_spend_usd: spend,
          ceiling_usd: 60,
          governed: outcomes >= 3,
        })
      }
      if (path === "/outcomes" && req.method === "POST") {
        if (req.headers["x-api-key"] === "pxy_bm") outcomes += 1
        return json(201, { recorded: true })
      }
      if (path === "/wallets/freeze") return json(200, { frozen: true })
      if (path === "/tokens") return json(200, {})
      if (path === "/authorize") {
        const amount = Number(body.amount_usd)
        if (body.merchant === "Google Ads") {
          google.push(amount)
          if (outcomes >= 3 && Math.round((spend + amount) * 100) > 6000 * outcomes) {
            return json(200, { status: "escalated", request_id: "req_cpo" })
          }
          spend += amount
          return json(200, { status: "approved" })
        }
        if (body.merchant === "TikTok Ads") return json(200, { status: "denied" })
        return json(200, { status: "approved" })
      }
      return json(404, { error: path })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const dir = await mkdtemp(join(tmpdir(), "sanction-cpo-pulse-"))
    try {
      await writeFile(join(dir, ".keys.coastline.json"), JSON.stringify(coastlineKeys()))
      const address = server.address() as { port: number }
      const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/demo/run.ts", "pulse", "coastline"], {
        cwd: process.cwd(),
        timeout: 20000,
        env: { ...process.env, DEMO_KEYS_DIR: dir, SANCTION_API_URL: `http://127.0.0.1:${address.port}/api/v1` },
      }).then(
        (ok) => ({ code: 0, stdout: ok.stdout, stderr: ok.stderr }),
        (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }),
      )
      return { result, google, requests, pending: JSON.parse(await readFile(join(dir, ".keys.coastline.json"), "utf8")) as Keys }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    }
  }

  it("arms an aged-out window then escalates the $12 probe", async () => {
    const { result, google, pending } = await pulseAgainst({ spend: 0, outcomes: 0 })
    expect(result.stderr, result.stderr).not.toContain("EXPECTATION MISMATCH")
    expect(result.code).toBe(0)
    expect(google).toEqual([48, 48, 48, 48, 12])
    expect(pending.pending).toHaveLength(1)
    expect(pending.pending[0]).toMatchObject({ seat: "bluebird-media-agent", kind: "spend" })
  }, 20000)

  it("does not re-spend when the window is already over the ceiling", async () => {
    const { result, google } = await pulseAgainst({ spend: 192, outcomes: 3 })
    expect(result.code).toBe(0)
    expect(google).toEqual([12])
  }, 20000)
})
