import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HEROES, HOSTS, POSITIONING } from "../app/home-copy"

vi.mock("@/app/brand-fonts", () => ({ brandFontVars: "" }))
vi.mock("@/components/signin-recovery", () => ({ SignInRecovery: () => null }))
vi.mock("@/components/operators-hour-ribbon", () => ({ OperatorsHourRibbon: () => null }))

afterEach(() => { vi.resetModules(); vi.doUnmock("../app/about/founder-note") })

async function render() {
  const { default: Landing, metadata } = await import("../app/page")
  return { html: renderToStaticMarkup(createElement(Landing)), metadata }
}

describe("public homepage", () => {
  it("leads with the selected positioning and the two ways in", async () => {
    const { html, metadata } = await render()
    expect(html).toContain(`<h1 class="sn-hero-h1">${HEROES[POSITIONING].headline}</h1>`)
    expect(html).toContain('href="/start"')
    expect(html).toContain('href="/install"')
    expect(String(metadata.title)).toContain(HEROES[POSITIONING].headline.replace(/\.$/, ""))
    expect(metadata.alternates).toEqual({ canonical: "/" })
  })

  it("resolves every in-page link to a section on the page", async () => {
    const { html } = await render()
    const anchors = [...html.matchAll(/href="#([a-z-]+)"/g)].map(match => match[1])
    expect(anchors).toEqual(expect.arrayContaining(["how", "teams", "pricing"]))
    for (const anchor of anchors) expect(html, anchor).toContain(`id="${anchor}"`)
  })

  it("never calls a host verified while the connection guide says its test is pending", () => {
    const guide = readFileSync("docs/CONNECT.md", "utf8").split("\n")
    for (const host of HOSTS) {
      const rows = guide.filter(line => line.startsWith(`| ${host.name}`))
      const pending = rows.some(row => /lifecycle (test|still) pending|unverified/i.test(row))
      if (pending) expect(host.tone, host.name).not.toBe("verified")
    }
    expect(guide.some(line => line.startsWith("| Claude |") && /redemption/.test(line))).toBe(true)
  })

  it("ships no placeholder, and no founder section until the note is written", async () => {
    const { html } = await render()
    expect(html).not.toContain("Why Sanction exists")
    expect(html).not.toMatch(/\[[A-Z0-9 -]{6,}/)
  })

  it("shows the founder's headline and first paragraph once the note exists", async () => {
    vi.doMock("../app/about/founder-note", () => ({ FOUNDER_NOTE: { headline: "A belief.", paragraphs: ["First.", "Second."] } }))
    const { html } = await render()
    expect(html).toContain("Why Sanction exists")
    expect(html).toContain("A belief.")
    expect(html).toContain("First.")
    expect(html).not.toContain("Second.")
    expect(html).toContain('href="/about"')
  })
})
