import { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fixture = vi.hoisted(() => ({
  mode: "batch",
  copyPending: false,
  pending: false,
  batchPending: false,
  lock: { current: false },
  key: "pxy_single_" + "a".repeat(64),
  seats: [
    { id: "seat-1", name: "Worker", agentKey: "pxy_batch_" + "b".repeat(64) },
    { id: "seat-2", name: "Worker", agentKey: "pxy_batch_" + "c".repeat(64) },
  ],
  activeCopy: "",
  statuses: new Map<string, string>(),
}))
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useActionState: (action: unknown) => action === createAgentAction
    ? [{ ok: true, agentKey: fixture.key, agentName: "Single" }, vi.fn(), fixture.pending]
    : [{ ok: true, seats: fixture.seats, templateName: "sandbox" }, vi.fn(), fixture.batchPending],
  useState: (initial: unknown) => {
    if (initial === "single") return [fixture.mode, (value: string) => { fixture.mode = value }]
    if (typeof initial === "boolean") return [fixture.copyPending, (value: boolean) => { fixture.copyPending = value }]
    const key = fixture.activeCopy
    return [fixture.statuses.get(key) ?? "idle", (value: string) => { fixture.statuses.set(key, value) }]
  },
  useRef: (initial: unknown) => initial === false ? fixture.lock : { current: initial },
  useEffect: () => {},
}))
vi.mock("@/app/dashboard/actions", () => ({ createAgentAction: vi.fn(), createBatchAgentsAction: vi.fn() }))
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }))
vi.mock("@/components/test-decision", () => ({ TestDecision: () => null }))
vi.mock("@/components/connect-app", () => ({ ConnectApp: () => null }))
import { createAgentAction } from "@/app/dashboard/actions"
import { AgentCreator } from "@/components/agent-creator"

type Element = ReactElement<Record<string, unknown>>
function findAll(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => findAll(child, predicate))
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [...(predicate(node) ? [node] : []), ...findAll(node.props.children as ReactNode, predicate)]
}
function tree() { return AgentCreator() }
function copies() { return findAll(tree(), node => typeof node.type === "function" && "start" in node.props) }
function copyTree(element: Element) {
  fixture.activeCopy = `${element.props.label}:${element.key}`
  return (element.type as (props: Record<string, unknown>) => ReactNode)(element.props)
}
function button(element: Element) { return findAll(copyTree(element), node => node.type === "button")[0] }
function click(element: Element) { return (button(element).props.onClick as () => Promise<void>)() }
function status(element: Element) { return renderToStaticMarkup(copyTree(element)) }

beforeEach(() => {
  fixture.mode = "batch"
  fixture.copyPending = false
  fixture.pending = false
  fixture.batchPending = false
  fixture.lock = { current: false }
  fixture.statuses.clear()
  fixture.key = "pxy_single_" + "a".repeat(64)
  fixture.seats[0].agentKey = "pxy_batch_" + "b".repeat(64)
})
afterEach(() => vi.unstubAllGlobals())

describe("agent creator clipboard controls", () => {
  it.each([0, 1, 2, 3])("serializes writes from control %i across single, curl, and different batch rows", async index => {
    let resolve!: () => void
    const writeText = vi.fn(() => new Promise<void>(done => { resolve = done }))
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const controls = copies()
    expect(controls).toHaveLength(4)
    // Keep pre-render callbacks to test the synchronous lock, not only disabled UI.
    const clicks = controls.map(control => button(control).props.onClick as () => Promise<void>)
    const writing = clicks[index]()
    for (const attempt of clicks) await attempt()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(controls[index].props.value)
    expect(status(controls[index])).toContain("copying…")
    expect(status(controls[index])).not.toContain("copied.")
    expect(copies().every(control => button(control).props.disabled)).toBe(true)
    const forms = findAll(tree(), node => node.type === "form")
    for (const form of forms) {
      const event = { preventDefault: vi.fn() }
      ;(form.props.onSubmit as (event: unknown) => void)(event)
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
    const buttons = findAll(tree(), node => node.type === "button")
    expect(buttons.every(control => control.props.disabled)).toBe(true)
    const modeButton = buttons.find(control => control.props.children === "Single seat")!
    ;(modeButton.props.onClick as () => void)()
    expect(fixture.mode).toBe("batch")
    resolve()
    await writing
    expect(status(controls[index])).toContain("copied.")
    expect(fixture.lock.current).toBe(false)
    expect(copies().every(control => !button(control).props.disabled)).toBe(true)
    const next = (index + 1) % controls.length
    const second = click(copies()[next])
    expect(writeText).toHaveBeenLastCalledWith(controls[next].props.value)
    resolve()
    await second
  })

  it.each(["rejected", "missing", "throws"])("handles %s clipboard without leaking errors and permits retry", async mode => {
    const writeText = vi.fn(() => {
      if (mode === "throws") throw new Error("private details")
      return Promise.reject(new Error("private details"))
    })
    vi.stubGlobal("navigator", { clipboard: mode === "missing" ? undefined : { writeText } })
    const control = copies()[2]
    await click(control)
    expect(status(control)).toContain("Copy failed. Select the text and copy it manually.")
    expect(status(control)).toContain('role="status"')
    expect(status(control)).toContain('aria-live="polite"')
    expect(status(control)).not.toContain("private details")
    expect(status(control)).not.toContain("copied.")
    expect(fixture.lock.current).toBe(false)
    const retry = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText: retry } })
    await click(copies()[2])
    expect(retry).toHaveBeenCalledExactlyOnceWith(fixture.seats[0].agentKey)
    expect(status(control)).toContain("copied.")
  })

  it("exposes complete read-only selectable keys with distinct labels even for duplicate names", () => {
    const fields = findAll(tree(), node => node.type === "input" && node.props.readOnly === true)
    expect(fields.map(field => field.props.value)).toEqual([fixture.key, ...fixture.seats.map(seat => seat.agentKey)])
    expect(new Set(fields.map(field => field.props["aria-label"])).size).toBe(3)
    expect(new Set(copies().map(control => button(control).props["aria-label"])).size).toBe(4)
    for (const field of fields) {
      expect(field.props.autoComplete).toBe("off")
      expect(field.props.className).not.toContain("truncate")
      const select = vi.fn()
      ;(field.props.onFocus as (event: unknown) => void)({ currentTarget: { select } })
      expect(select).toHaveBeenCalledOnce()
    }
  })

  it("resets success and failure feedback when single or batch keys are replaced", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    await click(copies()[0])
    await click(copies()[1])
    vi.stubGlobal("navigator", { clipboard: undefined })
    await click(copies()[2])
    const old = copies()
    fixture.key = "pxy_single_replacement"
    fixture.seats[0].agentKey = "pxy_batch_replacement"
    const replaced = copies()
    for (const index of [0, 1, 2]) {
      expect(replaced[index].key).not.toBe(old[index].key)
      expect(status(replaced[index])).not.toContain("copied.")
      expect(status(replaced[index])).not.toContain("Copy failed.")
    }
  })

  it.each(["pending", "batchPending"] as const)("blocks all copies while %s creation is pending", async pending => {
    fixture[pending] = true
    const writeText = vi.fn()
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    for (const control of copies()) {
      expect(button(control).props.disabled).toBe(true)
      await click(control)
    }
    expect(writeText).not.toHaveBeenCalled()
  })

  it("blocks single-seat form submission while a copy is pending", async () => {
    fixture.mode = "single"
    let resolve!: () => void
    vi.stubGlobal("navigator", { clipboard: { writeText: () => new Promise<void>(done => { resolve = done }) } })
    const writing = click(copies()[0])
    const form = findAll(tree(), node => node.type === "form")[0]
    const event = { preventDefault: vi.fn() }
    ;(form.props.onSubmit as (event: unknown) => void)(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    resolve()
    await writing
    event.preventDefault.mockClear()
    ;(form.props.onSubmit as (event: unknown) => void)(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
