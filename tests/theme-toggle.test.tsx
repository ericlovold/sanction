import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Store = {
  subscribe: (onChange: () => void) => () => void
  snapshot: () => string
}
const fixture = vi.hoisted(() => ({ inspect: false, stores: [] as Store[] }))
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>()
  return {
    ...react,
    useSyncExternalStore: <T,>(subscribe: (onChange: () => void) => () => void, snapshot: () => T, serverSnapshot?: () => T) => {
      if (!fixture.inspect) return react.useSyncExternalStore(subscribe, snapshot, serverSnapshot)
      fixture.stores.push({ subscribe, snapshot: snapshot as () => string })
      return snapshot()
    },
  }
})
import { ThemeToggle } from "@/components/theme-toggle"

function browser(initialDark = false) {
  let dark = initialDark
  const observers: { notify: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
  const root = {
    classList: {
      contains: (name: string) => name === "dark" && dark,
      toggle: vi.fn((_name: string, force: boolean) => { dark = force }),
    },
  }
  const setItem = vi.fn()
  vi.stubGlobal("document", { documentElement: root })
  vi.stubGlobal("localStorage", { setItem })
  vi.stubGlobal("MutationObserver", class {
    observe = vi.fn()
    disconnect = vi.fn()
    constructor(public notify: () => void) { observers.push(this) }
  })
  return { root, setItem, observers, isDark: () => dark }
}

beforeEach(() => {
  fixture.inspect = false
  fixture.stores = []
})
afterEach(() => vi.unstubAllGlobals())

describe("theme toggle", () => {
  it.each([false, true])("keeps server markup stable with a prepaint dark document (collapsed=%s)", collapsed => {
    vi.stubGlobal("document", undefined)
    const server = renderToStaticMarkup(createElement(ThemeToggle, { collapsed }))
    browser(true)
    const withDarkDocument = renderToStaticMarkup(createElement(ThemeToggle, { collapsed }))

    expect(withDarkDocument).toBe(server)
    expect(server).toContain('aria-label="Switch to dark mode"')
    expect(server).toContain('title="Dark mode"')
  })

  // The following tests inspect the store contract and callbacks. They do not
  // simulate React hydration; that requires a browser with the prepaint script.
  it("observes only root class changes and disconnects each subscription", () => {
    const { root, observers } = browser()
    fixture.inspect = true
    ThemeToggle({})
    const onChange = vi.fn()
    const unsubscribe = fixture.stores[0].subscribe(onChange)

    expect(observers).toHaveLength(1)
    expect(observers[0].observe).toHaveBeenCalledExactlyOnceWith(root, {
      attributes: true,
      attributeFilter: ["class"],
    })
    observers[0].notify()
    expect(onChange).toHaveBeenCalledOnce()
    unsubscribe()
    expect(observers[0].disconnect).toHaveBeenCalledOnce()
  })

  it("gives both controls the same changed snapshot and independent subscriptions", () => {
    const { observers } = browser()
    fixture.inspect = true
    const first = ThemeToggle({ collapsed: true })
    ThemeToggle({ collapsed: true })
    const changes = [vi.fn(), vi.fn()]
    const cleanups = fixture.stores.map((store, index) => store.subscribe(changes[index]))

    first.props.onClick()
    for (const observer of observers) observer.notify()
    expect(fixture.stores.map(store => store.snapshot())).toEqual(["dark", "dark"])
    for (const changed of changes) expect(changed).toHaveBeenCalledOnce()
    cleanups[0]()
    expect(observers[0].disconnect).toHaveBeenCalledOnce()
    expect(observers[1].disconnect).not.toHaveBeenCalled()
    cleanups[1]()
    expect(observers[1].disconnect).toHaveBeenCalledOnce()
  })

  it("toggles the live DOM even when another control has changed it since render", () => {
    const { isDark, setItem } = browser()
    fixture.inspect = true
    const first = ThemeToggle({})
    const second = ThemeToggle({})

    first.props.onClick()
    expect(isDark()).toBe(true)
    second.props.onClick()
    expect(isDark()).toBe(false)
    expect(setItem.mock.calls).toEqual([
      ["sanction-theme", "dark"],
      ["sanction-theme", "light"],
    ])
  })

  it("keeps toggling when storage is blocked", () => {
    const { isDark, setItem } = browser(true)
    setItem.mockImplementation(() => { throw new Error("Storage blocked") })
    fixture.inspect = true
    const control = ThemeToggle({})

    expect(control.props["aria-label"]).toBe("Switch to light mode")
    expect(() => control.props.onClick()).not.toThrow()
    expect(isDark()).toBe(false)
    expect(() => control.props.onClick()).not.toThrow()
    expect(isDark()).toBe(true)
  })
})
