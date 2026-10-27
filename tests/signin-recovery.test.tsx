import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"

const fixture = vi.hoisted(() => ({ query: "" }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(fixture.query) }))
import { SignInRecovery } from "@/components/signin-recovery"

beforeEach(() => { fixture.query = "" })

it("leaves ordinary visits unchanged", () => {
  expect(renderToStaticMarkup(createElement(SignInRecovery))).toBe("")
})

it("offers a fresh local login after a state mismatch, without trusting query destinations", () => {
  fixture.query = "error=state_mismatch&next=https://evil.example&error_description=private-provider-details"
  const html = renderToStaticMarkup(createElement(SignInRecovery))
  expect(html).toContain('role="alert"')
  expect(html).toContain('href="/login"')
  expect(html).toContain("same browser")
  expect(html).not.toContain("evil.example")
  expect(html).not.toContain("private-provider-details")
  expect(html).not.toContain("expired")
})

it("never echoes unknown errors and directs login-page users to the available methods", () => {
  fixture.query = "error=secret-provider-response&error_description=private-details"
  const html = renderToStaticMarkup(createElement(SignInRecovery, { onLoginPage: true }))
  expect(html).toContain("Choose a sign-in method below")
  expect(html).not.toContain('href="/login"')
  expect(html).not.toContain("secret-provider-response")
  expect(html).not.toContain("private-details")
})
