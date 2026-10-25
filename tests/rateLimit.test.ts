import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { db } from "../lib/db"
import { ipFromHeaders, clientIp, rateLimit } from "../lib/rateLimit"

vi.mock("../lib/db", () => ({ db: { $queryRaw: vi.fn() } }))

describe("ipFromHeaders — client IP extraction", () => {
  it("takes the first hop of x-forwarded-for", () => {
    expect(ipFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4")
  })

  it("trims whitespace around the first hop", () => {
    expect(ipFromHeaders(new Headers({ "x-forwarded-for": "  9.9.9.9 , 1.1.1.1" }))).toBe("9.9.9.9")
  })

  it("falls back to x-real-ip when no forwarded-for", () => {
    expect(ipFromHeaders(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8")
  })

  it("returns 'unknown' when no IP header is present", () => {
    expect(ipFromHeaders(new Headers())).toBe("unknown")
  })

  it("prefers forwarded-for over real-ip", () => {
    expect(ipFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "8.8.8.8" }))).toBe("1.2.3.4")
  })
})

describe("clientIp — from a Request", () => {
  it("reads the IP off the request headers", () => {
    const req = new Request("https://x.test", { headers: { "x-forwarded-for": "4.4.4.4" } })
    expect(clientIp(req)).toBe("4.4.4.4")
  })
})

describe("rateLimit — atomic counter response", () => {
  const now = new Date("2026-01-01T00:00:00.000Z")
  const end = new Date(now.getTime() + 60_000)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })
  afterEach(() => vi.useRealTimers())

  it("uses one parameterized query and allows the last request inside the limit", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([{ count: 120, windowEnd: end }])
    const ip = "127.0.0.1'; DROP TABLE ignored; --"
    expect(await rateLimit("mcp_hosted", ip, 120, 60)).toEqual({ ok: true, limit: 120 })
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
    const [sql, ...values] = vi.mocked(db.$queryRaw).mock.calls[0]
    expect(Array.from(sql as TemplateStringsArray).join("?")).not.toContain(ip)
    expect(values).toContain(`mcp_hosted:${ip}`)
    expect(values).toContainEqual(end)
  })

  it("denies above the limit using the persisted window, rounded up in seconds", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([
      { count: 121, windowEnd: new Date(now.getTime() + 1_001) },
    ])
    expect(await rateLimit("mcp_hosted", "127.0.0.1", 120, 60))
      .toEqual({ ok: false, retryAfter: 2, limit: 120 })
  })

  it("keeps Retry-After positive if the returned window is already due", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([{ count: 121, windowEnd: now }])
    expect(await rateLimit("mcp_hosted", "127.0.0.1", 120, 60))
      .toEqual({ ok: false, retryAfter: 1, limit: 120 })
  })

  it("propagates database failures instead of allowing the request", async () => {
    const failure = new Error("database unavailable")
    vi.mocked(db.$queryRaw).mockRejectedValue(failure)
    await expect(rateLimit("mcp_hosted", "127.0.0.1", 120, 60)).rejects.toBe(failure)
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it("fails closed if the database returns no counter", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([])
    await expect(rateLimit("mcp_hosted", "127.0.0.1", 120, 60))
      .rejects.toThrow("Rate limit counter was not returned")
  })
})
