import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { CreateState } from "@/app/start/actions"

const fixture = vi.hoisted(() => ({ state: { ok: false, error: "" } as CreateState }))
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useActionState: () => [fixture.state, vi.fn(), false],
}))
vi.mock("@/app/start/actions", () => ({ createWalletAction: vi.fn() }))
vi.mock("@/components/connect-app", () => ({ ConnectApp: () => null }))
import { CreateWallet } from "@/components/create-wallet"

describe("existing workspace recovery", () => {
  it("shows an accessible error and contextual sign-in link for the duplicate code", () => {
    fixture.state = { ok: false, error: "A wallet already exists for that email.", code: "WORKSPACE_EXISTS" }
    const html = renderToStaticMarkup(createElement(CreateWallet))

    expect(html).toContain('aria-live="polite" aria-atomic="true"')
    expect(html).toContain(fixture.state.error)
    expect(html).toMatch(/href="\/login"[^>]*>Sign in to my workspace/)
    expect(html).toContain("email link, Google, GitHub, or your management key")
    expect(html).not.toContain("/login?")
  })

  it.each([
    "",
    "Enter a workspace name and a valid email.",
    "Too many signups from this network. Try again later.",
    "A wallet already exists for that email.",
  ])("does not infer recovery from error text: %s", (error) => {
    fixture.state = { ok: false, error }
    const html = renderToStaticMarkup(createElement(CreateWallet))

    expect(html).not.toContain("Sign in to my workspace")
    expect(html).not.toContain("email link, Google, GitHub, or your management key")
    expect(html).toContain("Already have an account?")
    if (error) expect(html).toContain(error)
  })
})
