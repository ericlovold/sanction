import { createHash } from "node:crypto"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { BRAND_IDS, BrandIcon, BrandNotice } from "@/components/brand-icon"
import { PROVIDERS } from "@/lib/providers"
import { sourceNames } from "@/lib/usageObservation"

const render = (props: Parameters<typeof BrandIcon>[0]) => renderToStaticMarkup(createElement(BrandIcon, props))
const paths = (html: string) => [...html.matchAll(/<path d="([^"]+)" class="([^"]+)"/g)].map((m) => ({ d: m[1], fill: m[2] }))
const fingerprint = (html: string) => createHash("sha256").update(paths(html).map((p) => p.d).join("\n")).digest("hex")
const monogram = (html: string) => /<text[^>]*>([^<]*)<\/text>/.exec(html)?.[1]

// sha256 of each mark's path data as fetched from its owner on 2026-11-24
// (sources are listed at the top of components/brand-icon.tsx). The owners'
// guidelines forbid altering a mark, so path data must never be edited,
// simplified or re-exported. A new official version means a new hash here.
const MARKS = {
  blossom: "fb0a32a5384df5cdacc7d1a304f5b14df3c38a9a41ed08878adc99653efd0a33",
  anthropic: "99213d6177f6da0a3b809a6171bdfe75e103afa1da50b213e1defe1f606fd1fb",
  spark: "1097e5265789c38109fc8cbb44b39ddaff2b7e09739a51290d600f41b3e9a4b3",
  google: "cc5e5c9045b0c8842477113c41ef55170a33f2f96368f4814247622cbef16a7c",
  perplexity: "95196c669f7cfb89caa9ce83b06cd9193e29aced93a2ad212365703288baa58e",
}

// brand id, mark, and the owner's colours: one class per path.
const EXPECTED: [string, keyof typeof MARKS, string[]][] = [
  ["openai", "blossom", ["fill-black dark:fill-white"]],
  ["codex", "blossom", ["fill-black dark:fill-white"]],
  ["anthropic", "anthropic", ["fill-[#141413] dark:fill-[#faf9f5]", "fill-[#141413] dark:fill-[#faf9f5]"]],
  ["claude-code", "spark", ["fill-[#d97757]"]],
  ["gemini", "google", ["fill-[#4285f4]", "fill-[#34a853]", "fill-[#fbbc05]", "fill-[#ea4335]"]],
  ["perplexity", "perplexity", ["fill-[#121516] dark:fill-[#faf8f5]"]],
]

describe("BrandIcon", () => {
  it("covers every provider and usage source the dashboard names", () => {
    const needed = [...PROVIDERS.map((p) => p.id), ...Object.keys(sourceNames)]
    expect([...BRAND_IDS].sort()).toEqual([...needed].sort())
    expect(EXPECTED.map(([brand]) => brand).sort()).toEqual([...BRAND_IDS].sort())
  })

  it.each(EXPECTED)("renders %s as the unaltered %s mark in its owner's colours", (brand, mark, fills) => {
    const html = render({ brand })
    expect(html).toMatch(/^<svg viewBox="0 0 24 24"/)
    expect(html).toContain(`data-brand="${brand}"`)
    expect(html).toContain("<rect")
    expect(fingerprint(html)).toBe(MARKS[mark])
    expect(paths(html).map((p) => p.fill)).toEqual(fills)
    expect(monogram(html)).toBeUndefined()
  })

  it("falls back to an initial for an unknown brand, and never to a real mark", () => {
    expect(monogram(render({ brand: "mistral" }))).toBe("M")
    expect(monogram(render({ brand: "x-unknown", label: "élan" }))).toBe("É")
    for (const brand of ["", "---", "cursor", "__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const html = render({ brand })
      expect(html).toMatch(/^<svg /)
      expect(paths(html)).toEqual([])
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
