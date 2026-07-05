import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// The best-effort delivery layer: threshold notifications (the "no surprises"
// promise), webhook event fan-out, transactional email, the RLS transaction
// wrapper, and the fixed-window rate limiter. These run from after() in the
// hot paths, so the shared contract is: fire when they should, stay silent
// when they shouldn't, and never throw into the caller.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    wallet: { findUnique: vi.fn() },
    webhook: { findMany: vi.fn() },
    rateLimit: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("@/lib/webhooks", async (orig) => {
  const mod = await orig<typeof import("@/lib/webhooks")>()
  return { ...mod, deliverEvent: vi.fn(async () => {}) }
})
vi.mock("@/lib/email", async (orig) => {
  const mod = await orig<typeof import("@/lib/email")>()
  return { ...mod, sendBudgetThresholdEmail: vi.fn(async () => {}) }
})

import { notifySpendBudgetThreshold, notifyTokenBudgetThreshold, notifyPoolCapThresholds } from "../lib/thresholds"
import { deliverEvent as deliverEventMock } from "../lib/webhooks"
import { sendBudgetThresholdEmail } from "../lib/email"
import { withTenant } from "../lib/rls"
import { rateLimit, ipFromHeaders, clientIp } from "../lib/rateLimit"

const COMMON = { walletId: "wallet_1", ownerEmail: "owner@example.com", agentName: "tenet" }

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
})

// ── thresholds — the "no surprises" line ────────────────────────────────────

describe("thresholds — notify at the 80% line, before the wall", () => {
  it("fires webhook + email when a spend crossing happens", async () => {
    // $70 → $85 of a $100 cap crosses 80%
    await notifySpendBudgetThreshold({ ...COMMON, prevCents: 7000, nextCents: 8500, capCents: 10000 })
    expect(deliverEventMock).toHaveBeenCalledWith("wallet_1", "budget.threshold", expect.objectContaining({ scope: "daily_spend", pct_used: 85 }))
    expect(sendBudgetThresholdEmail).toHaveBeenCalledWith("owner@example.com", expect.objectContaining({ pctUsed: 85 }))
  })

  it("stays silent when no line is crossed (already past, or still below)", async () => {
    await notifySpendBudgetThreshold({ ...COMMON, prevCents: 8500, nextCents: 9000, capCents: 10000 }) // already past 80
    await notifySpendBudgetThreshold({ ...COMMON, prevCents: 1000, nextCents: 2000, capCents: 10000 }) // far below
    await notifySpendBudgetThreshold({ ...COMMON, prevCents: 1000, nextCents: 2000, capCents: null }) // no cap at all
    expect(deliverEventMock).not.toHaveBeenCalled()
  })

  it("token budgets use the same line in dollars", async () => {
    await notifyTokenBudgetThreshold({ ...COMMON, prevUsd: 7, nextUsd: 8.5, budgetUsd: 10 })
    expect(deliverEventMock).toHaveBeenCalledWith("wallet_1", "budget.threshold", expect.objectContaining({ scope: "daily_tokens" }))
  })

  it("pool crossings resolve the pool's name and notify one event per pool", async () => {
    dbMock.wallet.findUnique.mockResolvedValue({ name: "Marketing" })
    await notifyPoolCapThresholds("wallet_root", "owner@example.com", [
      { walletId: "wallet_pool", capCents: 50000, spentCents: 42000 },
    ])
    expect(deliverEventMock).toHaveBeenCalledWith("wallet_root", "budget.threshold", expect.objectContaining({ scope: "subtree_daily_spend", pool: "Marketing", pct_used: 84 }))
  })

  it("a failing email never throws into the caller (best-effort by contract)", async () => {
    vi.mocked(sendBudgetThresholdEmail).mockRejectedValue(new Error("resend down"))
    await expect(
      notifySpendBudgetThreshold({ ...COMMON, prevCents: 7000, nextCents: 8500, capCents: 10000 }),
    ).resolves.toBeUndefined()
  })
})

// ── webhooks — event fan-out ─────────────────────────────────────────────────

describe("webhook delivery — fan-out to subscribed endpoints", () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it("posts a signed body to every hook subscribed to the event (or *)", async () => {
    const { deliverEvent } = await vi.importActual<typeof import("../lib/webhooks")>("../lib/webhooks")
    dbMock.webhook.findMany.mockResolvedValue([
      { url: "https://a.example.com/h", secret: "whsec_a", events: ["approval.created"], isActive: true },
      { url: "https://b.example.com/h", secret: "whsec_b", events: ["*"], isActive: true },
      { url: "https://c.example.com/h", secret: "whsec_c", events: ["escalation.created"], isActive: true }, // not subscribed
    ])
    const fetchMock = vi.fn(async () => new Response("ok"))
    global.fetch = fetchMock as never

    await deliverEvent("wallet_1", "approval.created", { request_id: "req_1" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get("x-sanction-event")).toBe("approval.created")
    expect(headers.get("x-sanction-signature")).toMatch(/^sha256=[0-9a-f]{64}$/)
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ event: "approval.created", wallet_id: "wallet_1", request_id: "req_1" })
  })

  it("routes Slack URLs as Block Kit with a Review button and NO signature header", async () => {
    const { deliverEvent } = await vi.importActual<typeof import("../lib/webhooks")>("../lib/webhooks")
    dbMock.webhook.findMany.mockResolvedValue([
      { url: "https://hooks.slack.com/services/T0/B0/xyz", secret: "whsec_slack", events: ["*"], isActive: true },
    ])
    const fetchMock = vi.fn(async () => new Response("ok"))
    global.fetch = fetchMock as never

    await deliverEvent("wallet_1", "approval.created", { agent: "tenet", amount_usd: 60, merchant: "Vendor", reason: "Exceeds escalation threshold" })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get("x-sanction-signature")).toBeNull() // the Slack URL is the secret
    const payload = JSON.parse(String(init.body))
    expect(payload.blocks[0].text.text).toContain("tenet")
    expect(payload.blocks[0].text.text).toContain("$60.00")
    expect(payload.blocks[1].elements[0]).toMatchObject({ type: "button", url: expect.stringContaining("/dashboard/approvals") })
  })

  it("keeps signed raw JSON for non-Slack consumers on the same event", async () => {
    const { deliverEvent } = await vi.importActual<typeof import("../lib/webhooks")>("../lib/webhooks")
    dbMock.webhook.findMany.mockResolvedValue([
      { url: "https://hooks.slack.com/services/T0/B0/xyz", secret: "whsec_a", events: ["*"], isActive: true },
      { url: "https://api.example.com/hook", secret: "whsec_b", events: ["*"], isActive: true },
    ])
    const fetchMock = vi.fn(async () => new Response("ok"))
    global.fetch = fetchMock as never

    await deliverEvent("wallet_1", "budget.threshold", { scope: "daily_spend", pct_used: 84, spent_usd: 21, cap_usd: 25, agent: "tenet" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    const machine = calls.find(([u]) => String(u).includes("api.example.com"))!
    expect(new Headers(machine[1].headers).get("x-sanction-signature")).toMatch(/^sha256=/)
    expect(JSON.parse(String(machine[1].body))).toMatchObject({ event: "budget.threshold", wallet_id: "wallet_1", pct_used: 84 })
    const slack = calls.find(([u]) => String(u).includes("hooks.slack.com"))!
    expect(JSON.parse(String(slack[1].body)).blocks[0].text.text).toContain("84%")
  })

  it("formats the weekly digest for Slack: wk/wk delta, counts, busiest agent", async () => {
    const { slackPayload } = await vi.importActual<typeof import("../lib/webhooks")>("../lib/webhooks")
    const payload = JSON.parse(
      slackPayload("report.weekly_digest", {
        period_start: "2026-06-29", period_end: "2026-07-05",
        spend_usd: 120, prev_spend_usd: 80, token_cost_usd: 4.2,
        approved: 8, denied: 3, escalated: 1, secret_accesses: 2,
        top_agent: "tenet", top_agent_usd: 124.2,
      }),
    )
    const text = payload.blocks[0].text.text
    expect(text).toContain("$120.00")
    expect(text).toContain("▲50% wk/wk") // (120-80)/80
    expect(text).toContain("8 approved / 3 denied / 1 escalated")
    expect(text).toContain("tenet")
    expect(text).toContain("$124.20")
    // a flat week carries no delta noise
    const flat = JSON.parse(slackPayload("report.weekly_digest", { spend_usd: 80, prev_spend_usd: 80 }))
    expect(flat.blocks[0].text.text).not.toContain("wk/wk")
  })

  it("does nothing when no hook matches, and swallows delivery failures", async () => {
    const { deliverEvent, deliverPing } = await vi.importActual<typeof import("../lib/webhooks")>("../lib/webhooks")
    dbMock.webhook.findMany.mockResolvedValue([])
    const fetchMock = vi.fn(async () => { throw new Error("down") })
    global.fetch = fetchMock as never

    await deliverEvent("wallet_1", "approval.created", {})
    expect(fetchMock).not.toHaveBeenCalled()

    // ping posts once; a dead endpoint must not throw
    await expect(deliverPing("https://dead.example.com/h", "whsec_x")).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// ── email — dev fallback + Resend path ──────────────────────────────────────

describe("email — builds every message; dev fallback logs instead of sending", () => {
  it("all senders complete without a provider configured (RESEND_API_KEY unset)", async () => {
    const email = await vi.importActual<typeof import("../lib/email")>("../lib/email")
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    await email.sendLeadWelcomeEmail("a@x.com")
    await email.sendNewLeadEmail({ email: "a@x.com", source: "landing" })
    await email.sendMagicLinkEmail("a@x.com", "https://getsanction.com/magic?t=x")
    await email.sendBudgetThresholdEmail("a@x.com", { label: "tenet · daily spend budget", pctUsed: 85, spentUsd: 8.5, capUsd: 10 })
    await email.sendEscalationEmail("a@x.com", { agentName: "tenet", amountUsd: 60, merchant: "Vendor", category: "software", description: null, approveUrl: "https://x/approve" })
    expect(logSpy).toHaveBeenCalledTimes(5) // every message hit the dev log, none threw
    logSpy.mockRestore()
  })
})

// ── rls — the tenant transaction wrapper ────────────────────────────────────

describe("withTenant — scopes the transaction to the tenant GUC", () => {
  it("sets app.wallet_ids for a single tenant and hands fn the tx client", async () => {
    const result = await withTenant("wallet_1", async (tx) => {
      expect(tx).toBe(dbMock) // the transaction client, not the root client
      return "scoped"
    })
    expect(result).toBe("scoped")
    // the GUC was set inside the same transaction, with the id as a bound param
    expect(dbMock.$executeRaw).toHaveBeenCalledOnce()
    expect(dbMock.$executeRaw.mock.calls[0].some((a: unknown) => JSON.stringify(a).includes("wallet_1"))).toBe(true)
  })

  it("joins a subtree id list into one CSV membership set", async () => {
    await withTenant(["wallet_1", "wallet_2"], async () => null)
    expect(dbMock.$executeRaw.mock.calls[0].some((a: unknown) => JSON.stringify(a).includes("wallet_1,wallet_2"))).toBe(true)
  })
})

// ── rateLimit — fixed window against the db ─────────────────────────────────

describe("rateLimit — fixed window", () => {
  it("first request in a window resets the counter and passes", async () => {
    dbMock.rateLimit.findUnique.mockResolvedValue(null)
    dbMock.rateLimit.upsert.mockResolvedValue({})
    expect(await rateLimit("signup", "1.2.3.4", 5, 60)).toEqual({ ok: true, limit: 5 })
    expect(dbMock.rateLimit.upsert).toHaveBeenCalled()
  })

  it("passes under the limit, refuses over it with a retryAfter", async () => {
    const windowEnd = new Date(Date.now() + 30_000)
    dbMock.rateLimit.findUnique.mockResolvedValue({ key: "signup:1.2.3.4", count: 5, windowEnd })
    dbMock.rateLimit.update.mockResolvedValue({ count: 5 })
    expect((await rateLimit("signup", "1.2.3.4", 5, 60)).ok).toBe(true)

    dbMock.rateLimit.update.mockResolvedValue({ count: 6 })
    const over = await rateLimit("signup", "1.2.3.4", 5, 60)
    expect(over.ok).toBe(false)
    expect(over.retryAfter).toBeGreaterThanOrEqual(1)
    expect(over.retryAfter).toBeLessThanOrEqual(30)
  })

  it("an expired window starts fresh instead of refusing", async () => {
    dbMock.rateLimit.findUnique.mockResolvedValue({ key: "signup:1.2.3.4", count: 99, windowEnd: new Date(Date.now() - 1000) })
    dbMock.rateLimit.upsert.mockResolvedValue({})
    expect((await rateLimit("signup", "1.2.3.4", 5, 60)).ok).toBe(true)
  })

  it("client IP extraction: first XFF hop wins, x-real-ip is the fallback", () => {
    expect(ipFromHeaders(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9")
    expect(ipFromHeaders(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8")
    expect(ipFromHeaders(new Headers())).toBe("unknown")
    expect(clientIp(new Request("https://x.test", { headers: { "x-forwarded-for": "7.7.7.7" } }))).toBe("7.7.7.7")
  })
})
