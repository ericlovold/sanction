import { describe, it, expect, vi, beforeEach } from "vitest"

// Per-channel routing: the dashboard action turns the form's events[] into a
// validated subscription. Junk is dropped, "*" collapses to everything, and an
// empty selection falls back to the default set — a route can never be created
// subscribed to nothing.
const { dbMock } = vi.hoisted(() => ({
  dbMock: { webhook: { create: vi.fn() } },
}))
vi.mock("@/lib/db", () => ({ db: dbMock }))
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>()
  return { ...mod, after: () => {} }
})
vi.mock("@/lib/session", () => ({ requireSessionRole: vi.fn(async () => ({ id: "wallet_1", name: "Acme" })) }))
vi.mock("@/lib/webhooks", async (orig) => {
  const mod = await orig<typeof import("@/lib/webhooks")>()
  return { ...mod, deliverPing: vi.fn(async () => {}) }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { addWebhookAction } from "../app/dashboard/approvals/actions"
import { DEFAULT_EVENTS } from "../lib/webhooks"

function form(url: string, events: string[]) {
  const f = new FormData()
  f.set("url", url)
  for (const e of events) f.append("events", e)
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.webhook.create.mockResolvedValue({ id: "wh_1" })
})

describe("addWebhookAction — event subscriptions", () => {
  it("honors a chosen subset (the #finance-alerts route)", async () => {
    const res = await addWebhookAction({ ok: false, message: "" }, form("https://hooks.slack.com/services/T/B/x", ["budget.threshold", "budget.exhausted"]))
    expect(res.ok).toBe(true)
    expect(dbMock.webhook.create.mock.calls[0][0].data.events).toEqual(["budget.threshold", "budget.exhausted"])
  })

  it("drops unknown event names instead of persisting them", async () => {
    await addWebhookAction({ ok: false, message: "" }, form("https://hooks.example.com/h", ["budget.threshold", "nonsense.event"]))
    expect(dbMock.webhook.create.mock.calls[0][0].data.events).toEqual(["budget.threshold"])
  })

  it("collapses any selection containing * to just *", async () => {
    await addWebhookAction({ ok: false, message: "" }, form("https://hooks.example.com/h", ["approval.created", "*"]))
    expect(dbMock.webhook.create.mock.calls[0][0].data.events).toEqual(["*"])
  })

  it("falls back to the default set when nothing (or only junk) is selected", async () => {
    await addWebhookAction({ ok: false, message: "" }, form("https://hooks.example.com/h", []))
    expect(dbMock.webhook.create.mock.calls[0][0].data.events).toEqual(DEFAULT_EVENTS)
    await addWebhookAction({ ok: false, message: "" }, form("https://hooks.example.com/h", ["junk"]))
    expect(dbMock.webhook.create.mock.calls[1][0].data.events).toEqual(DEFAULT_EVENTS)
  })

  it("still refuses non-public URLs before touching anything", async () => {
    const res = await addWebhookAction({ ok: false, message: "" }, form("https://169.254.169.254/x", ["*"]))
    expect(res.ok).toBe(false)
    expect(dbMock.webhook.create).not.toHaveBeenCalled()
  })
})
