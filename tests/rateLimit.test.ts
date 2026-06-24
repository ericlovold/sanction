import { describe, it, expect } from "vitest"
import { ipFromHeaders, clientIp } from "../lib/rateLimit"

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
