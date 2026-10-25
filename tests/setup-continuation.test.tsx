import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { SetupContinuation } from "../components/setup-continuation"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

describe("dashboard connection handoff", () => {
  it.each([false, true])("keeps connection and inbox outside optional disclosures (proof complete: %s)", (proofComplete) => {
    const html = renderToStaticMarkup(createElement(SetupContinuation, { proofComplete }))
    const primary = html.split("<details>")[0]
    expect(primary).toContain('href="/docs/connect"')
    expect(primary).toContain('href="/dashboard/approvals"')
    expect(primary).toContain("does not intercept")
    expect(primary).not.toContain('href="/dashboard/walkthrough"')
    expect(html).toContain('href="/dashboard/walkthrough"')
    expect(html).toContain('href="/dashboard/connect"')
  })

  it("offers an explicit progress check without refreshing on render", () => {
    refresh.mockClear()
    const html = renderToStaticMarkup(createElement(SetupContinuation, { proofComplete: false }))
    expect(html).toContain("Check setup progress")
    expect(html).toContain("does not send a new approval request")
    expect(html).toContain('aria-live="polite"')
    expect(refresh).not.toHaveBeenCalled()
  })

  it("claims completed execution only with recorded proof", () => {
    const render = (proofComplete: boolean) => renderToStaticMarkup(createElement(SetupContinuation, { proofComplete }))
    expect(render(false)).not.toContain("One approved execution recorded")
    expect(render(true)).toContain("One approved execution recorded")
    expect(render(true)).toContain("Changed arguments and grant reuse were refused on the test path")
  })
  it("offers a harmless request after connection without claiming an authorization", () => {
    const html = renderToStaticMarkup(createElement(SetupContinuation, { proofComplete: false, hasMcpConnection: true }))
    expect(html).toContain("Connected. Next: request your first approval.")
    expect(html).toContain("First authorization not yet recorded")
    expect(html).toContain("Copy first approval request")
    expect(html).toContain("sanction.demo.approval")
    expect(html).toContain("require_approval")
    expect(html).toContain("Do not execute anything, retry, or poll")
    expect(html).not.toContain(">Connect your AI tool</a>")
    expect(html).not.toContain("One approved execution recorded")
  })

  it("shows a wallet authorization record without claiming execution or approval", () => {
    const html = renderToStaticMarkup(createElement(SetupContinuation, { proofComplete: false, hasMcpConnection: true, hasDecision: true }))
    expect(html).toContain("First authorization recorded in this wallet")
    expect(html).toContain("Open approval inbox")
    expect(html).not.toContain("Copy first approval request")
    expect(html).not.toContain("One approved execution recorded")
  })

  it("does not infer a connection from a previous authorization", () => {
    const html = renderToStaticMarkup(createElement(SetupContinuation, { proofComplete: false, hasMcpConnection: false, hasDecision: true }))
    expect(html).toContain("MCP connection not yet detected")
    expect(html).toContain(">Connect your AI tool</a>")
    expect(html).toContain("First authorization recorded in this wallet")
  })

})
