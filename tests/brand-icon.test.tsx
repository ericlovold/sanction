import { createHash } from "node:crypto"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { BRAND_IDS, BrandIcon, BrandNotice } from "@/components/brand-icon"
import { PROVIDERS } from "@/lib/providers"
import { sourceNames } from "@/lib/usageObservation"

const render = (props: Parameters<typeof BrandIcon>[0]) => renderToStaticMarkup(createElement(BrandIcon, props))
const pathData = (html: string) => /<path d="([^"]+)"/.exec(html)?.[1]
const monogram = (html: string) => /<text[^>]*>([^<]*)<\/text>/.exec(html)?.[1]

// sha256 of the Blossom path in Blossom_Light.svg from openai.com/brand,
// fetched 2026-11-24. OpenAI's guidelines forbid altering the mark, so the
// path data must never be edited, simplified or re-exported.
const BLOSSOM_SHA256 = "fb0a32a5384df5cdacc7d1a304f5b14df3c38a9a41ed08878adc99653efd0a33"

describe("BrandIcon", () => {
  it("covers every provider and usage source the dashboard names", () => {
    const needed = [...PROVIDERS.map((p) => p.id), ...Object.keys(sourceNames)]
    expect([...BRAND_IDS].sort()).toEqual([...needed].sort())
  })

  it.each(BRAND_IDS)("renders %s as one tile with a mark or a monogram", (brand) => {
    const html = render({ brand })
    expect(html).toMatch(/^<svg viewBox="0 0 24 24"/)
    expect(html).toContain(`data-brand="${brand}"`)
    expect(html).toContain("<rect")
    expect(Boolean(pathData(html)) !== Boolean(monogram(html))).toBe(true)
  })

  it.each(["openai", "codex"])("shows the unaltered OpenAI mark for %s, black on light and white on dark", (brand) => {
    const html = render({ brand })
    expect(createHash("sha256").update(pathData(html)!).digest("hex")).toBe(BLOSSOM_SHA256)
    expect(html).toContain('class="fill-black dark:fill-white"')
  })

  it.each([["anthropic", "A"], ["claude-code", "C"], ["gemini", "G"], ["perplexity", "P"]])(
    "shows a neutral monogram for %s, whose guidelines do not grant logo use",
    (brand, letter) => {
      const html = render({ brand })
      expect(monogram(html)).toBe(letter)
      expect(pathData(html)).toBeUndefined()
    },
  )

  it("falls back to an initial for an unknown brand, and never to a real mark", () => {
    expect(monogram(render({ brand: "mistral" }))).toBe("M")
    expect(monogram(render({ brand: "x-unknown", label: "élan" }))).toBe("É")
    for (const brand of ["", "---", "__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const html = render({ brand })
      expect(html).toMatch(/^<svg /)
      expect(pathData(html)).toBeUndefined()
    }
    expect(render({ brand: "" })).toContain("<circle")
    expect(render({ brand: "---" })).toContain("<circle")
  })

  it("is hidden from assistive tech unless a label is given", () => {
    expect(render({ brand: "openai" })).toContain('aria-hidden="true"')
    const labelled = render({ brand: "openai", label: "OpenAI" })
    expect(labelled).toContain('role="img"')
    expect(labelled).toContain('aria-label="OpenAI"')
    expect(labelled).not.toContain("aria-hidden")
  })

  it("is sized by the caller and does not shrink in a flex row", () => {
    const html = render({ brand: "anthropic", size: 28, className: "mt-px" })
    expect(html).toContain('width="28"')
    expect(html).toContain('height="28"')
    expect(html).toContain('class="shrink-0 mt-px"')
    expect(render({ brand: "anthropic" })).toContain('width="20"')
  })
})

describe("BrandNotice", () => {
  it("says the marks are not Sanction's and imply no endorsement", () => {
    const html = renderToStaticMarkup(createElement(BrandNotice))
    expect(html).toContain("belong to their owners")
    expect(html).toContain("do not imply endorsement")
  })
})
