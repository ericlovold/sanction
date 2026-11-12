import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
vi.mock("@/app/brand-fonts", () => ({ brandFontVars: "" }))
import InstallPage from "../app/install/page"
import { DOCS, readDoc } from "../lib/docs"

function html() {
  return renderToStaticMarkup(createElement(InstallPage))
}

describe("public /install hub", () => {
  it("links each tool shortcut to its setup or availability section", () => {
    const page = html()
    for (const id of ["claude", "cursor", "codex", "grok", "slack", "chatgpt"]) {
      expect(page).toContain(`href="#${id}"`)
      expect(page).toContain(`id="${id}"`)
    }
    expect(page).toContain("https://getsanction.com/mcp/approvals")
    expect(page).toContain('href="/docs/developer-usage"')
    expect(page).toContain('href="/docs/connect#host=grok-consumer&amp;step=connect"')
    expect(page).toContain('href="/docs/chatgpt-codex"')
    expect(page).toContain('href="/slack"')
    expect(page).toContain('href="/connect/mcp"')
    expect(page).toContain('id="disconnect"')
  })

  it("distinguishes community listings, custom installs, and unavailable listings", () => {
    const page = html()
    expect(page).toContain("No verified public listing")
    expect(page).toContain('href="https://cursor.directory/plugins/sanction"')
    expect(page).toContain("outside the official Cursor Marketplace")
    expect(page).toContain('href="https://claude.ai/directory/sanction-approvals"')
    expect(page).toContain("fresh installation unverified")
    expect(page).toContain("Slack Marketplace submission is not complete")
    expect(page).toContain("does not intercept")
    expect(page).not.toMatch(/install Sanction from ChatGPT/i)
  })
})

describe("ChatGPT/Codex setup-disconnect guide", () => {
  it("is registered and tells reviewers how to disconnect without claiming a ChatGPT listing", () => {
    expect(DOCS["chatgpt-codex"]?.file).toBe("CHATGPT-CODEX.md")
    const doc = readDoc("chatgpt-codex")
    expect(doc?.md).toMatch(/## Disconnect/)
    expect(doc?.md).toContain("/connect/mcp")
    expect(doc?.md).toContain("codex mcp add sanction")
    expect(doc?.md).toContain("no verified public ChatGPT listing")
    expect(doc?.md).toMatch(/Management-key[\s\S]*not[\s\S]*enough for OAuth/)
    expect(doc?.md).not.toMatch(/install Sanction from ChatGPT/)
  })
})

describe("first-run pages point at /install", () => {
  it("lets a new account find per-host install steps before signing in", () => {
    const src = readFileSync(new URL("../app/start/page.tsx", import.meta.url), "utf8")
    expect(src).toContain('href="/install"')
    expect(src).toContain("Per-host steps")
  })
})
