import { beforeEach, describe, expect, it, vi } from "vitest"
import { identityEmailCallback, identityEmailRateKey, issueIdentityEmailEnvelope, readIdentityEmailEnvelope } from "@/lib/identityEmailLogin"

describe("identity email link binding", () => {
  beforeEach(() => { vi.stubEnv("BETTER_AUTH_SECRET", "test-only-identity-secret-long-enough-for-hmac"); vi.useRealTimers() })
  it("binds the credential to its callback and normalized identity", async () => {
    const callback = "/api/auth/oauth2/authorize?client_id=test&resource=https%3A%2F%2Fgetsanction.com%2Fmcp%2Fapprovals"
    const envelope = await issueIdentityEmailEnvelope("opaque-token", "Reviewer@Example.com", callback)
    expect(await readIdentityEmailEnvelope(envelope)).toEqual({ token: "opaque-token", email: "reviewer@example.com", callback })
    expect(identityEmailRateKey("Reviewer@Example.com")).toBe(identityEmailRateKey(" reviewer@example.com "))
    expect(identityEmailRateKey("Reviewer@Example.com")).not.toContain("example")
  })
  it("rejects modified and expired links", async () => {
    vi.useFakeTimers()
    const envelope = await issueIdentityEmailEnvelope("opaque-token", "reviewer@example.com", "/dashboard")
    const [header, body, signature] = envelope.split(".")
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), callback: "/connect/mcp" })).toString("base64url")
    await expect(readIdentityEmailEnvelope(`${header}.${changed}.${signature}`)).rejects.toThrow()
    vi.advanceTimersByTime(901_000)
    await expect(readIdentityEmailEnvelope(envelope)).rejects.toThrow()
    vi.useRealTimers()
  })
  it.each(["https://evil.test/", "//evil.test/", "/\\evil.test/", "/dashboard#token", "/api/auth/sign-out", "/dashboard%0a", "/other", "/connect/mcp/../login"])("rejects unsafe or out-of-scope callback %s", value => {
    expect(() => identityEmailCallback(value)).toThrow()
  })
})
