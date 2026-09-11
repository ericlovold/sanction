import { beforeEach, describe, it, expect, vi } from "vitest"
import { NextRequest } from "next/server"
const mocks = vi.hoisted(() => ({ auth: vi.fn(), createMany: vi.fn() }))
vi.mock("../lib/auth", () => ({ authenticateAgent: mocks.auth }))
vi.mock("../lib/db", () => ({ db: { usageObservation: { createMany: mocks.createMany } } }))
import { POST } from "../app/api/v1/usage/otlp/[source]/route"
const body = { resourceLogs: [{ scopeLogs: [{ logRecords: [{ timeUnixNano: "1789142400000000000", attributes: [
  { key: "event.name", value: { stringValue: "codex.conversation_starts" } },
  { key: "conversation.id", value: { stringValue: "session" } },
] }] }] }] }
function send(value: unknown = body, source = "codex", type = "application/json") {
  return POST(new NextRequest("http://localhost/api/v1/usage/otlp/codex", { method: "POST", headers: { "content-type": type }, body: JSON.stringify(value) }), { params: Promise.resolve({ source }) })
}
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ agent: { id: "seat", wallet: { policy: { dailyTokenBudgetUsd: 0 } } } }); mocks.createMany.mockResolvedValue({ count: 1 }) })
describe("usage ingestion", () => {
  it("records observations under authenticated identity regardless of a zero budget", async () => {
    const r = await send()
    expect(r.status).toBe(200)
    expect(r.headers.get("cache-control")).toBe("no-store")
    expect(mocks.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true, data: [{ agentId: "seat" }] })
  })
  it("rejects invalid authentication, source, encoding, and payloads", async () => {
    expect((await send(body, "other")).status).toBe(404)
    expect((await send(body, "codex", "application/x-protobuf")).status).toBe(415)
    expect((await send({})).status).toBe(400)
    expect((await send("x".repeat(1_048_577))).status).toBe(413)
    mocks.auth.mockResolvedValue({ agent: null, error: "expired" })
    expect((await send()).status).toBe(401)
    expect(mocks.createMany).not.toHaveBeenCalled()
  })
})
