import { beforeEach, describe, expect, it, vi } from "vitest"
const mock = vi.hoisted(() => ({ agents: vi.fn(), latest: vi.fn() }))
vi.mock("../lib/db", () => ({ db: { agent: { findMany: mock.agents }, usageObservation: { findFirst: mock.latest } } }))
import { developerConfig, developerConnection } from "../lib/developerConnection"

const now = new Date("2026-09-13T12:00:00Z")
beforeEach(() => { vi.clearAllMocks(); mock.agents.mockResolvedValue([{ id: "own-seat", name: "My client" }]); mock.latest.mockResolvedValue(null) })
describe("developer connection", () => {
  it.each(["", "foreign-seat", "expired-seat", "revoked-seat"])("does not read usage for unavailable seat %s", async seat => {
    const result = await developerConnection("owner", seat, "codex", now)
    expect(result.selected).toBeNull()
    expect(mock.latest).not.toHaveBeenCalled()
    expect(mock.agents).toHaveBeenCalledWith(expect.objectContaining({ where: { walletId: "owner", isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }))
  })
  it("checks the selected source and seat inside the wallet, never wallet-wide delivery", async () => {
    const result = await developerConnection("owner", "own-seat", "claude-code", now)
    expect(result.latest).toBeNull()
    expect(result.recent).toBe(false)
    expect(mock.latest).toHaveBeenCalledWith(expect.objectContaining({ where: { agentId: "own-seat", source: "claude-code", agent: { walletId: "owner" } } }))
  })
  it("reports recent receipt while preserving the original old event time", async () => {
    const old = new Date("2026-09-10T12:00:00Z")
    mock.latest.mockResolvedValue({ receivedAt: now, occurredAt: old })
    const result = await developerConnection("owner", "own-seat", "codex", now)
    expect(result.recent).toBe(true)
    expect(result.latest?.occurredAt).toEqual(old)
  })
  it("does not call old delivery recent", async () => {
    mock.latest.mockResolvedValue({ receivedAt: new Date(now.getTime() - 900001), occurredAt: now })
    expect((await developerConnection("owner", "own-seat", "codex", now)).recent).toBe(false)
  })
  it("uses only public placeholders in JSON log configuration", () => {
    expect(developerConfig("codex")).toContain('protocol = "json"')
    expect(developerConfig("codex")).toContain('"x-api-key" = "YOUR_SEAT_KEY"')
    expect(developerConfig("claude-code")).toContain('x-api-key=$SANCTION_AGENT_KEY')
    expect(developerConfig("claude-code")).toContain('OTEL_LOG_ASSISTANT_RESPONSES=0')
    expect(developerConfig("claude-code")).toContain('/usage/otlp/claude-code')
  })
})
