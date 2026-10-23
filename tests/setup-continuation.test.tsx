import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { SetupContinuation } from "../components/setup-continuation"

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

  it("claims completed execution only with recorded proof", () => {
    const render = (proofComplete: boolean) => renderToStaticMarkup(createElement(SetupContinuation, { proofComplete }))
    expect(render(false)).not.toContain("One approved execution recorded")
    expect(render(true)).toContain("One approved execution recorded")
    expect(render(true)).toContain("Changed arguments and grant reuse were refused on the test path")
  })
})
