import { createElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Result = { status: string; amount: number; reason?: string }
const fixture = vi.hoisted(() => ({
  decisions: [] as Result[],
  pending: null as number | null,
  lock: { current: false },
  fetch: vi.fn(),
  track: vi.fn(),
}))
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => Array.isArray(initial)
    ? [fixture.decisions, (update: (previous: Result[]) => Result[]) => { fixture.decisions = update(fixture.decisions) }]
    : [fixture.pending, (value: number | null) => { fixture.pending = value }],
  useRef: () => fixture.lock,
}))
vi.mock("@vercel/analytics", () => ({ track: fixture.track }))
import { TestDecision } from "@/components/test-decision"

function buttons(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(buttons)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return node.type === "button" ? [node] : buttons(node.props.children as ReactNode)
}
function controls() { return buttons(TestDecision({ agentKey: "test-key" })) }
function click(button: ReactElement<Record<string, unknown>>) { return (button.props.onClick as () => Promise<void>)() }
function markup(variant: "dark" | "light" = "dark") {
  return renderToStaticMarkup(createElement(TestDecision, { agentKey: "test-key", variant }))
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

beforeEach(() => {
  fixture.decisions = []
  fixture.pending = null
  fixture.lock = { current: false }
  fixture.fetch.mockReset()
  fixture.track.mockReset()
  vi.stubGlobal("fetch", fixture.fetch)
})
afterEach(() => vi.unstubAllGlobals())

describe("authorization test result recovery", () => {
  it.each([
    ["approved", 200], ["escalated", 200], ["denied", 200], ["denied", 403], ["denied", 402],
  ])("preserves %s at HTTP %s and unlocks the next test", async (status, httpStatus) => {
    fixture.fetch.mockResolvedValue(response({ status, reason: "Policy explanation" }, Number(httpStatus)))
    expect(controls()).toHaveLength(1)
    await click(controls()[0])
    expect(fixture.decisions).toEqual([{ status, amount: 5, reason: "Policy explanation" }])
    expect(controls()).toHaveLength(2)
    expect(markup()).toContain("Approval does not execute a purchase.")
    expect(markup()).toContain('role="log"')
    expect(markup()).toContain('aria-live="polite"')
    expect(markup()).toContain("Policy explanation")
    await click(controls()[1])
    expect(fixture.fetch).toHaveBeenLastCalledWith("/api/v1/authorize", {
      method: "POST", headers: { "x-api-key": "test-key", "content-type": "application/json" },
      body: JSON.stringify({ action: "purchase", amount_usd: 40, merchant: "OpenAI", category: "software" }),
    })
  })

  it.each([
    null, [], {}, "approved", { status: "unknown" }, { status: "approved", reason: {} },
    { status: "denied", reason: null }, { status: 1 },
  ])("rejects malformed decision payload %j without unlocking the next test", async (body) => {
    fixture.fetch.mockResolvedValue(response(body))
    await click(controls()[0])
    expect(fixture.decisions).toEqual([{ status: "error", amount: 5, reason: expect.stringContaining("Check the authorization log before another attempt") }])
    expect(controls()).toHaveLength(1)
    expect(controls()[0].props.disabled).toBe(false)
    expect(markup()).not.toContain("Approval does not execute a purchase.")
    expect(fixture.fetch).toHaveBeenCalledTimes(1)
  })

  it.each([500, 502, 403])("does not accept an approved body at HTTP %s", async (status) => {
    fixture.fetch.mockResolvedValue(response({ status: "approved" }, status))
    await click(controls()[0])
    expect(fixture.decisions[0].status).toBe("error")
    expect(controls()).toHaveLength(1)
  })

  it.each(["network", "invalid JSON", "server denial"])("handles %s as an uncertain outcome without retrying", async (mode) => {
    if (mode === "network") fixture.fetch.mockRejectedValue(new Error("private network details"))
    else if (mode === "invalid JSON") fixture.fetch.mockResolvedValue(new Response("not JSON"))
    else fixture.fetch.mockResolvedValue(response({ status: "denied" }, 500))
    await click(controls()[0])
    expect(fixture.decisions[0].status).toBe("error")
    for (const variant of ["dark", "light"] as const) {
      expect(markup(variant)).toContain("Could not confirm the authorization outcome. Check the authorization log before another attempt.")
      expect(markup(variant)).not.toContain("truncate")
      expect(markup(variant)).not.toContain("private network details")
    }
    expect(fixture.fetch).toHaveBeenCalledTimes(1)
    fixture.fetch.mockResolvedValue(response({ status: "approved" }))
    await click(controls()[0])
    expect(fixture.fetch).toHaveBeenCalledTimes(2)
    expect(controls()).toHaveLength(2)
  })

  it("blocks same-tick callbacks and both buttons while a request is pending", async () => {
    fixture.fetch.mockResolvedValueOnce(response({ status: "approved" }))
    await click(controls()[0])
    let resolve!: (value: Response) => void
    fixture.fetch.mockImplementation(() => new Promise(done => { resolve = done }))
    const original = controls()
    const pending = click(original[1])
    await click(original[1])
    await click(original[0])
    expect(fixture.fetch).toHaveBeenCalledTimes(2)
    expect(controls().every(button => button.props.disabled === true)).toBe(true)
    expect(markup()).toContain("Checking…")
    resolve(response({ status: "denied" }, 403))
    await pending
    expect(fixture.decisions).toHaveLength(2)
    expect(controls().every(button => button.props.disabled === false)).toBe(true)
  })

  it.each(["approved", "denied"])("keeps the %s decision when analytics throws", async (status) => {
    fixture.track.mockImplementation(() => { throw new Error("analytics failure") })
    fixture.fetch.mockResolvedValue(response({ status }, status === "denied" ? 403 : 200))
    await click(controls()[0])
    expect(fixture.decisions).toEqual([{ status, amount: 5, reason: undefined }])
    expect(controls()).toHaveLength(2)
    expect(controls().every(button => button.props.disabled === false)).toBe(true)
  })
})
