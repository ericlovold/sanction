import { createElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const fixture = vi.hoisted(() => ({
  loading: null as string | null,
  error: "",
  lock: { current: false },
  social: vi.fn(),
}))
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => initial === null
    ? [fixture.loading, (value: string | null) => { fixture.loading = value }]
    : [fixture.error, (value: string) => { fixture.error = value }],
  useRef: () => fixture.lock,
}))
vi.mock("@/lib/auth-client", () => ({ authClient: { signIn: { social: fixture.social } } }))
import { SocialSignIn } from "@/components/social-signin"

function buttons(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(buttons)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return node.type === "button" ? [node] : buttons(node.props.children as ReactNode)
}

function controls(props: Parameters<typeof SocialSignIn>[0] = {}) {
  return buttons(SocialSignIn(props))
}
function click(button: ReactElement<Record<string, unknown>>) {
  return (button.props.onClick as () => Promise<void>)()
}
function markup() {
  return renderToStaticMarkup(createElement(SocialSignIn))
}

beforeEach(() => {
  fixture.loading = null
  fixture.error = ""
  fixture.lock = { current: false }
  fixture.social.mockReset()
})

describe("social sign-in recovery", () => {
  it.each(["returned error", "rejected request", "synchronous throw"])("announces %s and allows retry without exposing details", async (mode) => {
    const privateError = new Error("private provider details")
    if (mode === "returned error") fixture.social.mockResolvedValue({ data: null, error: privateError })
    else if (mode === "rejected request") fixture.social.mockRejectedValue(privateError)
    else fixture.social.mockImplementation(() => { throw privateError })

    await click(controls()[0])

    expect(controls().every(button => button.props.disabled === false)).toBe(true)
    expect(markup()).toContain('role="alert"')
    expect(markup()).toContain("Could not start sign-in. Try again or choose another sign-in method.")
    expect(markup()).not.toContain(privateError.message)

    let resolve!: (value: unknown) => void
    fixture.social.mockImplementation(() => new Promise(done => { resolve = done }))
    const retry = click(controls()[1])
    expect(markup()).not.toContain('role="alert"')
    expect(controls().every(button => button.props.disabled === true)).toBe(true)
    expect(fixture.social).toHaveBeenLastCalledWith({ provider: "github", callbackURL: "/dashboard", errorCallbackURL: "/login?next=%2Fdashboard" })
    resolve({ data: { url: "https://example.test/oauth", redirect: true }, error: null })
    await retry
    expect(markup()).toContain("Redirecting…")
    expect(controls().every(button => button.props.disabled === true)).toBe(true)
  })

  it("blocks overlapping provider clicks and stays pending after successful redirect initiation", async () => {
    let resolve!: (value: unknown) => void
    fixture.social.mockImplementation(() => new Promise(done => { resolve = done }))
    const original = controls({ callbackURL: "/connect/mcp?request=test", apple: true })
    const pending = click(original[0])
    await click(original[1])
    await click(original[2])
    expect(fixture.social).toHaveBeenCalledExactlyOnceWith({ provider: "google", callbackURL: "/connect/mcp?request=test", errorCallbackURL: "/login?next=%2Fconnect%2Fmcp%3Frequest%3Dtest" })
    expect(controls({ apple: true }).every(button => button.props.disabled === true)).toBe(true)
    resolve({ data: { url: "https://example.test/oauth", redirect: true }, error: null })
    await pending
    await click(original[1])
    expect(fixture.social).toHaveBeenCalledTimes(1)
    expect(markup()).toContain("Redirecting…")
    expect(markup()).not.toContain('role="alert"')
  })

  it("keeps Apple opt-in and forwards its callback unchanged", async () => {
    expect(controls()).toHaveLength(2)
    expect(markup()).not.toContain("Continue with Apple")
    fixture.social.mockResolvedValue({ data: { redirect: true }, error: null })
    const apple = controls({ apple: true, callbackURL: "/invite/test-token" })
    expect(apple).toHaveLength(3)
    await click(apple[2])
    expect(fixture.social).toHaveBeenCalledExactlyOnceWith({ provider: "apple", callbackURL: "/invite/test-token", errorCallbackURL: "/login?next=%2Finvite%2Ftest-token" })
  })

  it("keeps error recovery local even when the requested callback is external", async () => {
    fixture.social.mockResolvedValue({ data: { redirect: true }, error: null })
    await click(controls({ callbackURL: "https://untrusted.example" })[0])
    expect(fixture.social.mock.calls[0][0].errorCallbackURL).toBe("/login?next=%2Fdashboard")
  })
})
