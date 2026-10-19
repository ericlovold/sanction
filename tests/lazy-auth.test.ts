import { describe, expect, it, vi } from "vitest"
import { toNextJsHandler } from "better-auth/next-js"
import { lazyAuth } from "../lib/lazyAuth"

function instance(context: Promise<unknown> = Promise.resolve({})) {
  return {
    $context: context,
    api: { getSession: vi.fn().mockResolvedValue({ user: { id: "user_1" } }), mutate: vi.fn() },
    handler: vi.fn().mockResolvedValue(new Response("ok")),
  }
}

describe("lazy auth initialization", () => {
  it("does not treat the API namespace as a promise or initialize it when awaited", async () => {
    const create = vi.fn(() => instance())
    const auth = lazyAuth(create)
    expect(await Promise.resolve(auth.api)).toBe(auth.api)
    expect(create).not.toHaveBeenCalled()
  })

  it("does not initialize on import, API access, or route adapter creation", () => {
    const create = vi.fn(() => instance())
    const auth = lazyAuth(create)
    void auth.api.getSession
    toNextJsHandler(auth)
    expect(create).not.toHaveBeenCalled()
  })

  it("shares pending initialization across API, context and handler consumers", async () => {
    let resolve!: () => void
    const underlying = instance(new Promise<void>((done) => { resolve = done }))
    const create = vi.fn(() => underlying)
    const auth = lazyAuth(create)
    const session = auth.api.getSession()
    const response = toNextJsHandler(auth).GET(new Request("https://example.test/api/auth/get-session"))
    const context = auth.$context
    expect(create).toHaveBeenCalledTimes(1)
    expect(underlying.api.getSession).not.toHaveBeenCalled()
    resolve()
    await Promise.all([session, response, context])
    expect(underlying.handler).toHaveBeenCalledTimes(1)
    expect(underlying.api.getSession).toHaveBeenCalledTimes(1)
  })

  it("rejects the failed request and recovers on the next request without replay", async () => {
    const failed = instance(Promise.reject(new Error("database unavailable")))
    const healthy = instance()
    const create = vi.fn().mockReturnValueOnce(failed).mockReturnValue(healthy)
    const auth = lazyAuth(create)
    await expect(auth.api.getSession()).rejects.toThrow("database unavailable")
    expect(failed.api.getSession).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(1)
    await expect(auth.api.getSession()).resolves.toMatchObject({ user: { id: "user_1" } })
    expect(create).toHaveBeenCalledTimes(2)
  })

  it("observes context rejection even before a caller awaits it", async () => {
    const create = vi.fn(() => instance(Promise.reject(new Error("offline"))))
    const auth = lazyAuth(create)
    // Deliberately do not attach a caller catch: Vitest fails on unhandled rejection.
    void auth.$context
    await new Promise((done) => setTimeout(done, 0))
    expect(create).toHaveBeenCalledTimes(1)
    await expect(auth.api.getSession()).rejects.toThrow("offline")
    expect(create).toHaveBeenCalledTimes(2)
  })

  it("keeps permanent initialization failure closed on every request", async () => {
    const create = vi.fn(() => instance(Promise.reject(new Error("invalid configuration"))))
    const auth = lazyAuth(create)
    for (let i = 0; i < 3; i++) await expect(auth.api.getSession()).rejects.toThrow("invalid configuration")
    expect(create).toHaveBeenCalledTimes(3)
  })

  it("preserves API endpoint metadata and method identity", () => {
    const underlying = instance()
    Object.assign(underlying.api.getSession, { path: "/get-session", options: { method: "GET" } })
    const auth = lazyAuth(() => underlying)
    expect(auth.api.getSession).toBe(auth.api.getSession)
    expect(Reflect.get(auth.api.getSession, "path")).toBe("/get-session")
    expect(Reflect.get(auth.api.getSession, "options")).toEqual({ method: "GET" })
  })

  it("does not reset initialization or retry an endpoint mutation failure", async () => {
    const underlying = instance()
    underlying.api.mutate.mockRejectedValue(new Error("write failed"))
    const create = vi.fn(() => underlying)
    const auth = lazyAuth(create)
    await expect(auth.api.mutate()).rejects.toThrow("write failed")
    await auth.api.getSession()
    expect(create).toHaveBeenCalledTimes(1)
    expect(underlying.api.mutate).toHaveBeenCalledTimes(1)
  })
})
