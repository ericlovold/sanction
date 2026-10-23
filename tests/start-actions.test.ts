import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findWallet: vi.fn(),
  createWallet: vi.fn(),
  createAgent: vi.fn(),
  rateLimit: vi.fn(),
  cookie: vi.fn(),
  setSession: vi.fn(),
  track: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  db: {
    wallet: { findUnique: mocks.findWallet, create: mocks.createWallet },
    agent: { create: mocks.createAgent },
  },
}))
vi.mock("@/lib/rateLimit", () => ({ rateLimit: mocks.rateLimit, ipFromHeaders: () => "test-ip" }))
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: mocks.cookie }),
}))
vi.mock("@/lib/session", () => ({ setSession: mocks.setSession }))
vi.mock("@vercel/analytics/server", () => ({ track: mocks.track }))
vi.mock("@/lib/apiKey", () => ({
  generateManagementKey: () => ({ raw: "sk_test", hash: "management-hash", prefix: "sk_test" }),
  generateApiKey: () => ({ raw: "pxy_test", hash: "agent-hash", prefix: "pxy_test" }),
}))

import { createWalletAction } from "@/app/start/actions"
import { ACQ_COOKIE } from "@/lib/acquisition"

function signupForm(name = "Test workspace", email = "signup@example.test") {
  const form = new FormData()
  form.set("name", name)
  form.set("email", email)
  return form
}

const initialState = { ok: false as const, error: "" }

describe("signup tracking", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.rateLimit.mockResolvedValue({ ok: true })
    mocks.findWallet.mockResolvedValue(null)
    mocks.createWallet.mockResolvedValue({ id: "test-wallet" })
    mocks.createAgent.mockResolvedValue({ id: "test-agent" })
    mocks.setSession.mockResolvedValue(undefined)
    mocks.track.mockResolvedValue(undefined)
  })

  it.each([
    { cookie: undefined, channel: "direct" },
    { cookie: JSON.stringify({ source: "slack", medium: "community" }), channel: "slack" },
    { cookie: "malformed", channel: "direct" },
  ])("emits one server event with channel $channel for cookie $cookie", async ({ cookie, channel }) => {
    mocks.cookie.mockReturnValue(cookie === undefined ? undefined : { value: cookie })

    expect(await createWalletAction(initialState, signupForm())).toEqual({
      ok: true,
      walletId: "test-wallet",
      managementKey: "sk_test",
      agentKey: "pxy_test",
      agentName: "default-agent",
    })
    expect(mocks.cookie).toHaveBeenCalledWith(ACQ_COOKIE)
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith("wallet_created", { source: "web", channel })
    expect(mocks.createAgent).toHaveBeenCalledExactlyOnceWith({
      data: { walletId: "test-wallet", name: "default-agent", apiKeyHash: "agent-hash", apiKeyPrefix: "pxy_test" },
    })
    expect(mocks.setSession).toHaveBeenCalledExactlyOnceWith("sk_test")
  })

  it.each([
    ["", "signup@example.test"],
    ["Test workspace", "invalid"],
  ])("does not track invalid input (%s, %s)", async (name, email) => {
    expect(await createWalletAction(initialState, signupForm(name, email))).toEqual({
      ok: false, error: "Enter a workspace name and a valid email.",
    })
    expect(mocks.findWallet).not.toHaveBeenCalled()
    expect(mocks.track).not.toHaveBeenCalled()
    expect(mocks.createWallet).not.toHaveBeenCalled()
    expect(mocks.setSession).not.toHaveBeenCalled()
  })

  it("does not track duplicate signups", async () => {
    mocks.findWallet.mockResolvedValue({ id: "existing-wallet" })

    expect(await createWalletAction(initialState, signupForm())).toEqual({
      ok: false, error: "A wallet already exists for that email.",
    })
    expect(mocks.track).not.toHaveBeenCalled()
    expect(mocks.createWallet).not.toHaveBeenCalled()
    expect(mocks.createAgent).not.toHaveBeenCalled()
    expect(mocks.setSession).not.toHaveBeenCalled()
  })

  it("does not track rate-limited signups", async () => {
    mocks.rateLimit.mockResolvedValue({ ok: false })

    expect(await createWalletAction(initialState, signupForm())).toEqual({
      ok: false, error: "Too many signups from this network. Try again later.",
    })
    expect(mocks.rateLimit).toHaveBeenCalledExactlyOnceWith("wallet_create", "test-ip", 15, 3600)
    expect(mocks.findWallet).not.toHaveBeenCalled()
    expect(mocks.track).not.toHaveBeenCalled()
    expect(mocks.createWallet).not.toHaveBeenCalled()
    expect(mocks.setSession).not.toHaveBeenCalled()
  })

  it("does not let an analytics outage prevent signup or login", async () => {
    mocks.track.mockRejectedValue(new Error("Analytics unavailable"))

    expect(await createWalletAction(initialState, signupForm())).toMatchObject({ ok: true })
    expect(mocks.track).toHaveBeenCalledTimes(1)
    expect(mocks.setSession).toHaveBeenCalledExactlyOnceWith("sk_test")
  })
})
