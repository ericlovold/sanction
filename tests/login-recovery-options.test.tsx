import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"
vi.mock("@/app/brand-fonts", () => ({ brandFontVars: "" }))
vi.mock("@/components/signin-recovery", () => ({ SignInRecovery: () => null }))
vi.mock("@/components/social-signin", () => ({ SocialSignIn: ({ callbackURL }: { callbackURL: string }) => createElement("a", { href: callbackURL }, "Social sign-in") }))
vi.mock("@/components/magic-link-form", () => ({ MagicLinkForm: () => createElement("div", null, "Legacy email login") }))
vi.mock("@/components/login-form", () => ({ LoginForm: () => createElement("div", null, "Legacy key login") }))
import LoginPage from "@/app/login/page"

it("offers identity sign-in only for invite recovery, preserving the invite target", async () => {
  const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ next: "/invite/test-token" }) }))
  expect(html).toContain("Sign in to accept your invite")
  expect(html).toContain('href="/invite/test-token"')
  expect(html).toContain("Social sign-in")
  expect(html).not.toContain("Legacy email login")
  expect(html).not.toContain("Legacy key login")
  expect(html).not.toContain("Have a management key")
})

it.each(["/dashboard", "/dashboard/approvals?review=test", "https://untrusted.example/invite/test"])("preserves ordinary recovery methods for %s", async next => {
  const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ next }) }))
  expect(html).toContain("Social sign-in")
  expect(html).toContain("Legacy email login")
  expect(html).toContain("Legacy key login")
  expect(html).not.toContain("Sign in to accept your invite")
  expect(html).not.toContain("untrusted.example")
})
