import { createElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fixture = vi.hoisted(() => ({
  status: "idle",
  copyPending: false,
  pending: false,
  lock: { current: false },
  key: "pxy_test_" + "a".repeat(64),
}))
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useActionState: () => [{ ok: true, agentKey: fixture.key, agentName: "Test" }, vi.fn(), fixture.pending],
  useState: (initial: unknown) => typeof initial === "boolean"
    ? [fixture.copyPending, (value: boolean) => { fixture.copyPending = value }]
    : [fixture.status, (value: string) => { fixture.status = value }],
  useRef: (initial: unknown) => initial === false ? fixture.lock : { current: initial },
  useEffect: () => {},
}))
vi.mock("@/app/dashboard/actions", () => ({ createAgentAction: vi.fn() }))
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }))
import { RosterAddAgent } from "@/components/roster-add-agent"

function find(node: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, predicate)
      if (found) return found
    }
  }
  if (!isValidElement<Record<string, unknown>>(node)) return
  if (predicate(node)) return node
  return find(node.props.children as ReactNode, predicate)
}
function tree() { return RosterAddAgent({ walletId: "test-wallet" }) }
function copyElement() { return find(tree(), (node) => typeof node.type === "function")! }
function copyButton() {
  const element = copyElement()
  return find((element.type as (props: Record<string, unknown>) => ReactNode)(element.props), node => node.type === "button")!
}
function markup() { return renderToStaticMarkup(createElement(RosterAddAgent, { walletId: "test-wallet" })) }

beforeEach(() => {
  fixture.status = "idle"
  fixture.copyPending = false
  fixture.pending = false
  fixture.lock = { current: false }
  fixture.key = "pxy_test_" + "a".repeat(64)
})
afterEach(() => vi.unstubAllGlobals())

describe("roster agent key copying", () => {
  it("waits for completion, blocks repeated clicks and form submission while copying", async () => {
    let resolve!: () => void
    const writeText = vi.fn(() => new Promise<void>(done => { resolve = done }))
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const click = copyButton().props.onClick as () => Promise<void>
    const pending = click()
    await click()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(fixture.key)
    expect(fixture.status).toBe("pending")
    expect(copyButton().props.disabled).toBe(true)
    expect(markup()).toContain("Copying agent key…")
    const submit = find(tree(), node => node.type === "button" && node.props.type === "submit")!
    expect(submit.props.disabled).toBe(true)
    const form = find(tree(), node => node.type === "form")!
    const event = { preventDefault: vi.fn() }
    ;(form.props.onSubmit as (submitted: typeof event) => void)(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    resolve()
    await pending
    expect(fixture.status).toBe("copied")
    expect(fixture.lock.current).toBe(false)
    expect(copyButton().props.disabled).toBe(false)
    event.preventDefault.mockClear()
    ;(form.props.onSubmit as (submitted: typeof event) => void)(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(markup()).toContain("Agent key copied.")
  })

  it.each(["rejected", "missing", "throws"])("recovers from %s clipboard access and permits retry", async mode => {
    const writeText = vi.fn(() => {
      if (mode === "throws") throw new Error("private details")
      return Promise.reject(new Error("private details"))
    })
    vi.stubGlobal("navigator", { clipboard: mode === "missing" ? undefined : { writeText } })
    await (copyButton().props.onClick as () => Promise<void>)()
    expect(fixture.status).toBe("failed")
    expect(fixture.lock.current).toBe(false)
    expect(markup()).toContain("Copy failed. Select the key and copy it manually.")
    expect(markup()).not.toContain("private details")
    const retry = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText: retry } })
    await (copyButton().props.onClick as () => Promise<void>)()
    expect(retry).toHaveBeenCalledExactlyOnceWith(fixture.key)
    expect(fixture.status).toBe("copied")
  })

  it("provides the full selectable key and remounts feedback for a replacement key", () => {
    const input = find(tree(), node => node.type === "input" && node.props["aria-label"] === "Agent key")!
    expect(input.props.value).toBe(fixture.key)
    expect(input.props.readOnly).toBe(true)
    const select = vi.fn()
    ;(input.props.onFocus as (event: unknown) => void)({ currentTarget: { select } })
    expect(select).toHaveBeenCalledOnce()
    expect(markup()).toContain('role="status"')
    expect(markup()).not.toContain("truncate")
    const oldKey = copyElement().key
    fixture.key = "pxy_replacement"
    expect(copyElement().key).toBe(fixture.key)
    expect(copyElement().key).not.toBe(oldKey)
  })

  it("does not start copying while agent creation is pending", async () => {
    fixture.pending = true
    const writeText = vi.fn()
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    expect(copyButton().props.disabled).toBe(true)
    await (copyButton().props.onClick as () => Promise<void>)()
    expect(writeText).not.toHaveBeenCalled()
  })
})
