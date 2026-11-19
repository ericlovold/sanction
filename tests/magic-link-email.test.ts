import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const recipient = "owner@example.test"
const link = "https://getsanction.com/auth/verify?token=fixture-only"

beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe("recovery email credentials", () => {
  it.each(["production", "development"] as const)("fails closed without a provider in %s without logging the credential", async mode => {
    vi.stubEnv("NODE_ENV", mode)
    vi.stubEnv("RESEND_API_KEY", "")
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const { sendMagicLinkEmail } = await import("../lib/email")

    await expect(sendMagicLinkEmail(recipient, link)).rejects.toThrow("not configured")
    expect(log).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("delivers a configured recovery email without logging its credential", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-only-provider-key")
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetch)
    const { sendMagicLinkEmail } = await import("../lib/email")

    await sendMagicLinkEmail(recipient, link)
    expect(fetch).toHaveBeenCalledOnce()
    const message = JSON.parse(fetch.mock.calls[0][1].body)
    expect(message.to).toBe(recipient)
    expect(message.text).toContain(link)
    expect(message.html).toContain(link)
    expect(log).not.toHaveBeenCalled()
  })

  it("preserves the development fallback for a noncredential welcome email", async () => {
    vi.stubEnv("RESEND_API_KEY", "")
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const { sendLeadWelcomeEmail } = await import("../lib/email")

    await sendLeadWelcomeEmail(recipient)
    expect(log).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
  })
})
