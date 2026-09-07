import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
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
})
