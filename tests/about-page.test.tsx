import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
vi.mock("@/app/brand-fonts", () => ({ brandFontVars: "" }))

afterEach(() => { vi.resetModules(); vi.doUnmock("../app/about/founder-note") })

async function render() {
  const { default: About, metadata } = await import("../app/about/page")
  return { html: renderToStaticMarkup(createElement(About)), metadata }
}

describe("public /about", () => {
  it("describes the product and sends consulting to the founder's own site", async () => {
    const { html, metadata } = await render()
    expect(html).toContain("Sanction lets AI agents ask before they act.")
    expect(html).toContain('href="https://www.ericlovold.com"')
    expect(html).toContain('href="/support"')
    for (const gone of ["advisory and implementation firm", "Book discovery", "calendly.com", "Services"]) {
      expect(html, gone).not.toContain(gone)
    }
    expect(metadata.title).toBe("About Sanction")
    expect(String(metadata.description)).not.toMatch(/advisory|consult/i)
    expect(metadata.alternates).toEqual({ canonical: "/about" })
  })

  it("links each open-record claim to where it can be checked", async () => {
    const { html } = await render()
    for (const href of ["https://github.com/ericlovold/sanction", "/changelog", "/roadmap", "/docs/connect"]) {
      expect(html).toContain(`href="${href}"`)
    }
  })

  it("shows no founder note, and no placeholder, until one is written", async () => {
    const { html } = await render()
    expect(html).not.toContain("Why I built it")
    expect(html).not.toMatch(/\[YOUR|TODO|lorem/i)
    expect(html).toContain("Who builds it")
  })

  it("publishes the founder note once it is set", async () => {
    vi.doMock("../app/about/founder-note", () => ({ FOUNDER_NOTE: { headline: "A headline", paragraphs: ["First.", "Second."] } }))
    const { html } = await render()
    expect(html).toContain("Why I built it")
    expect(html).toContain("A headline")
    expect(html).toContain("Second.")
    expect(html).not.toContain("Who builds it")
  })
})
