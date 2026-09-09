import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Markdown } from "../components/markdown"
import { ROADMAP } from "../lib/roadmap"
import nextConfig from "../next.config"

describe("public site: /pricing is not a 404", () => {
  it("permanently redirects bookmarks to the platform pricing section", async () => {
    const redirects = await nextConfig.redirects!()
    expect(redirects).toContainEqual({
      source: "/pricing",
      destination: "/platform#pricing",
      permanent: true,
    })
  })
})

describe("public site: /roadmap renders markdown notes", () => {
  it("passes card notes through the shared Markdown component, not a plain <p>", () => {
    const src = readFileSync(new URL("../app/roadmap/page.tsx", import.meta.url), "utf8")
    expect(src).toContain("<Markdown source={it.note} />")
    expect(src).not.toMatch(/<p[^>]*>\{it\.note\}<\/p>/)
  })

  it("renders every curated note as HTML with no leftover ** or backticks", () => {
    const items = [...ROADMAP.now, ...ROADMAP.next, ...ROADMAP.later]
    for (const it of items) {
      const html = renderToStaticMarkup(createElement(Markdown, { source: it.note }))
      const text = html.replace(/<[^>]+>/g, "")
      expect(text, it.title).not.toContain("**")
      expect(text, it.title).not.toContain("`")
      if (it.note.includes("**")) expect(html, it.title).toContain("<strong")
      if (it.note.includes("`")) expect(html, it.title).toContain("<code")
    }
  })
})
