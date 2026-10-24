import { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fixture = vi.hoisted(() => ({
  lang: "Node", provider: "OpenAI", pending: false, lock: { current: false },
  activeCopy: "", statuses: new Map<string, string>(), key: "pxy_test_key",
}))
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    if (initial === "Node") return [fixture.lang, (value: string) => { fixture.lang = value }]
    if (initial === "OpenAI") return [fixture.provider, (value: string) => { fixture.provider = value }]
    if (initial === false) return [fixture.pending, (value: boolean) => { fixture.pending = value }]
    const key = fixture.activeCopy
    return [fixture.statuses.get(key) ?? "idle", (value: string) => { fixture.statuses.set(key, value) }]
  },
  useRef: () => fixture.lock,
}))
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }))
vi.mock("@/components/gateway-watch", () => ({ GatewayWatch: () => null }))
import { track } from "@vercel/analytics"
import { ConnectApp } from "@/components/connect-app"

type Element = ReactElement<Record<string, unknown>>
function findAll(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => findAll(child, predicate))
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [...(predicate(node) ? [node] : []), ...findAll(node.props.children as ReactNode, predicate)]
}
function tree() { return ConnectApp({ agentKey: fixture.key, showWatch: false }) }
function copies() { return findAll(tree(), node => typeof node.type === "function" && "start" in node.props) }
function child(element: Element) { return (element.type as (props: Record<string, unknown>) => ReactNode)(element.props) }
function copyTree(element: Element) {
  fixture.activeCopy = `${element.props.label}:${element.key}`
  return child(element)
}
function button(element: Element) { return findAll(copyTree(element), node => node.type === "button")[0] }
function click(element: Element) { return (button(element).props.onClick as () => Promise<void>)() }
function status(element: Element) { return renderToStaticMarkup(copyTree(element)) }
function toggles() { return findAll(tree(), node => typeof node.type === "function" && "options" in node.props) }

beforeEach(() => {
  fixture.lang = "Node"
  fixture.provider = "OpenAI"
  fixture.pending = false
  fixture.lock = { current: false }
  fixture.statuses.clear()
  fixture.key = "pxy_test_key"
  vi.mocked(track).mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe("ConnectApp clipboard controls", () => {
  it.each([0, 1])("serializes delayed write %i across both controls and blocks switching", async index => {
    let resolve!: () => void
    const writeText = vi.fn(() => new Promise<void>(done => { resolve = done }))
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const controls = copies()
    const clicks = controls.map(control => button(control).props.onClick as () => Promise<void>)
    const switches = toggles().map(toggle => toggle.props.onChange as (value: string) => void)
    const writing = clicks[index]()
    for (const attempt of clicks) await attempt()
    switches[0]("Gemini")
    switches[1]("Python")
    expect(fixture.provider).toBe("OpenAI")
    expect(fixture.lang).toBe("Node")
    expect(writeText).toHaveBeenCalledExactlyOnceWith(controls[index].props.value)
    expect(status(controls[index])).toContain("copying…")
    expect(status(controls[index])).not.toContain("copied.")
    expect(track).not.toHaveBeenCalled()
    expect(copies().every(control => button(control).props.disabled)).toBe(true)
    for (const toggle of toggles()) {
      expect(findAll(child(toggle), node => node.type === "button").every(node => node.props.disabled)).toBe(true)
    }
    resolve()
    await writing
    expect(status(controls[index])).toContain("copied.")
    expect(fixture.lock.current).toBe(false)
    expect(copies().every(control => !button(control).props.disabled)).toBe(true)
    if (index === 1) expect(track).toHaveBeenCalledExactlyOnceWith("snippet_copied", { provider: "OpenAI", lang: "Node" })
    else expect(track).not.toHaveBeenCalled()
  })

  it.each(["rejected", "missing", "throws"])("handles %s clipboard, supports manual copy, and permits retry", async mode => {
    const writeText = vi.fn(() => {
      if (mode === "throws") throw new Error("private details")
      return Promise.reject(new Error("private details"))
    })
    vi.stubGlobal("navigator", { clipboard: mode === "missing" ? undefined : { writeText } })
    for (const control of copies()) {
      await click(control)
      expect(status(control)).toContain("Copy failed. Select the text and copy it manually.")
      expect(status(control)).toContain('role="status"')
      expect(status(control)).toContain('aria-live="polite"')
      expect(status(control)).not.toContain("private details")
      expect(status(control)).not.toContain("copied.")
      expect(fixture.lock.current).toBe(false)
    }
    expect(track).not.toHaveBeenCalled()
    const retry = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText: retry } })
    for (const control of copies()) {
      await click(control)
      expect(retry).toHaveBeenLastCalledWith(control.props.value)
      expect(status(control)).toContain("copied.")
    }
    expect(track).toHaveBeenCalledOnce()
  })

  it("keeps clipboard success when analytics throws", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    vi.mocked(track).mockImplementation(() => { throw new Error("tracking unavailable") })
    const control = copies()[1]
    await click(control)
    expect(status(control)).toContain("SDK snippet copied.")
    expect(status(control)).not.toContain("Copy failed")
    expect(fixture.lock.current).toBe(false)
  })

  it.each(["provider", "lang", "key"] as const)("resets both feedback controls when %s changes", async field => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    await click(copies()[0])
    vi.stubGlobal("navigator", { clipboard: undefined })
    await click(copies()[1])
    const previous = copies()
    if (field === "key") fixture.key = "pxy_replacement"
    else (toggles()[field === "provider" ? 0 : 1].props.onChange as (value: string) => void)(field === "provider" ? "Anthropic" : "Python")
    copies().forEach((control, index) => {
      expect(control.key).not.toBe(previous[index].key)
      expect(status(control)).not.toContain("copied.")
      expect(status(control)).not.toContain("Copy failed.")
    })
  })

  it("keeps the lock across key replacement while old completion cannot update new feedback", async () => {
    let resolve!: () => void
    const writeText = vi.fn(() => new Promise<void>(done => { resolve = done }))
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const writing = click(copies()[1])
    fixture.key = "pxy_new"
    await click(copies()[0])
    expect(writeText).toHaveBeenCalledOnce()
    expect(copies().every(control => button(control).props.disabled)).toBe(true)
    resolve()
    await writing
    expect(status(copies()[1])).not.toContain("copied.")
    expect(fixture.lock.current).toBe(false)
  })

  it("exposes the complete selectable install command and preserves the visible snippet", () => {
    fixture.provider = "Anthropic"
    const field = findAll(tree(), node => node.type === "input")[0]
    expect(field.props.value).toBe("npm i @anthropic-ai/sdk")
    expect(field.props.readOnly).toBe(true)
    expect(field.props["aria-label"]).toBe("Install command")
    expect(field.props.className).not.toContain("truncate")
    const select = vi.fn()
    ;(field.props.onFocus as (event: unknown) => void)({ currentTarget: { select } })
    expect(select).toHaveBeenCalledOnce()
    const pre = findAll(tree(), node => node.type === "pre")[0]
    const code = findAll(pre, node => node.type === "code")[0]
    expect(code.props.children).toBe(copies()[1].props.value)
    expect(new Set(copies().map(control => button(control).props["aria-label"])).size).toBe(2)
  })
})
