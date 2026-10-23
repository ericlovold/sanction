import { Children, createElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MagicLinkRequestState } from "@/app/login/actions"

const fixture = vi.hoisted(() => ({
  state: undefined as MagicLinkRequestState | undefined,
  attempt: 0,
  pending: false,
  dispatch: vi.fn(),
}))
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useActionState: (_action: unknown, initial: MagicLinkRequestState) => [fixture.state ?? initial, fixture.dispatch, fixture.pending],
  useState: () => [fixture.attempt, (update: (value: number) => number) => { fixture.attempt = update(fixture.attempt) }],
}))
vi.mock("@/app/login/actions", () => ({ requestMagicLinkAction: vi.fn() }))
import { requestMagicLinkAction } from "@/app/login/actions"
import { MagicLinkForm } from "@/components/magic-link-form"

beforeEach(() => {
  fixture.state = undefined
  fixture.attempt = 0
  fixture.pending = false
  vi.clearAllMocks()
})

describe("email sign-in recovery", () => {
  it("shows conditional inbox and spam guidance with an accessible status", () => {
    fixture.state = { sent: true, error: "" }
    const html = renderToStaticMarkup(createElement(MagicLinkForm))
    expect(html).toContain('role="status"')
    expect(html).toContain("If that email has a wallet")
    expect(html).toContain("inbox and spam folder")
    expect(html).toContain("15 minutes")
    expect(html).toContain('type="button"')
    expect(html).toContain("Try another email or resend")
    expect(html).not.toContain('type="email"')
  })

  it("remounts the form on retry without sending and retains the destination", () => {
    fixture.state = { sent: true, error: "" }
    const next = "/dashboard/approvals?review=request-test"
    const before = MagicLinkForm({ next })
    const attempt = (before.type as (props: typeof before.props) => ReactElement<{ children: ReactElement[] }>)(before.props)
    const button = Children.toArray(attempt.props.children).find((child) => (child as ReactElement).type === "button") as ReactElement<{ type: string; onClick: () => void }>
    expect(button.props.type).toBe("button")
    button.props.onClick()

    const after = MagicLinkForm({ next })
    expect(after.type).toBe(before.type)
    expect(after.key).not.toBe(before.key)
    expect(after.props.next).toBe(next)
    // A changed React key mounts a fresh action hook with its initial state.
    fixture.state = undefined
    const html = renderToStaticMarkup(after)
    expect(html).toContain('type="email"')
    expect(html).toContain('autofocus=""')
    expect(html).toContain(`name="next" value="${next}"`)
    expect(html).not.toContain('role="status"')
    expect(fixture.dispatch).not.toHaveBeenCalled()
    expect(requestMagicLinkAction).not.toHaveBeenCalled()
  })

  it("keeps errors accessible and lets the user correct the email", () => {
    fixture.state = { sent: false, error: "Please try again later." }
    const html = renderToStaticMarkup(createElement(MagicLinkForm))
    expect(html).toContain('role="alert"')
    expect(html).toContain(fixture.state.error)
    expect(html).toContain('type="email"')
    expect(html).toContain('name="next" value="/dashboard"')
  })

  it("keeps submission disabled while pending", () => {
    fixture.pending = true
    const html = renderToStaticMarkup(createElement(MagicLinkForm))
    expect(html).toContain('type="submit" disabled=""')
    expect(html).toContain("Sending…")
    expect(html).not.toContain("Try another email or resend")
  })
})
