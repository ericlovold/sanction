import { describe, expect, it } from "vitest"
import { acquisitionFromRequest, parseAcquisitionCookie } from "@/lib/acquisition"

describe("acquisitionFromRequest", () => {
  it("captures utm params and the landing path", () => {
    const url = new URL("https://getsanction.com/docs/bedrock?utm_source=hn&utm_medium=post&utm_campaign=launch")
    expect(acquisitionFromRequest(url, null)).toEqual({
      source: "hn",
      medium: "post",
      campaign: "launch",
      referrer: undefined,
      landing: "/docs/bedrock",
    })
  })

  it("accepts ?src= and ?ref= as source aliases, utm_source winning", () => {
    const src = new URL("https://getsanction.com/?src=mcp")
    expect(acquisitionFromRequest(src, null)?.source).toBe("mcp")
    const both = new URL("https://getsanction.com/?utm_source=github&src=mcp")
    expect(acquisitionFromRequest(both, null)?.source).toBe("github")
  })

  it("captures an external referrer host, ignores same-site referrers", () => {
    const url = new URL("https://getsanction.com/start")
    expect(acquisitionFromRequest(url, "https://news.ycombinator.com/item?id=1")?.referrer).toBe(
      "news.ycombinator.com",
    )
    expect(acquisitionFromRequest(url, "https://getsanction.com/docs")).toBeNull()
  })

  it("returns null when nothing is attributable", () => {
    expect(acquisitionFromRequest(new URL("https://getsanction.com/"), null)).toBeNull()
    expect(acquisitionFromRequest(new URL("https://getsanction.com/?page=2"), "not a url")).toBeNull()
  })

  it("clamps and sanitizes hostile values", () => {
    const url = new URL(`https://getsanction.com/?utm_source=${"a".repeat(200)}%00%0A`)
    const acq = acquisitionFromRequest(url, null)
    expect(acq?.source).toHaveLength(100)
    expect(acq?.source).toBe("a".repeat(100))
  })
})

describe("parseAcquisitionCookie", () => {
  it("round-trips a cookie written from a capture", () => {
    const acq = acquisitionFromRequest(new URL("https://getsanction.com/?src=mcp"), null)
    expect(parseAcquisitionCookie(JSON.stringify(acq))).toEqual({
      source: "mcp",
      medium: undefined,
      campaign: undefined,
      referrer: undefined,
      landing: "/",
    })
  })

  it("degrades junk to null instead of throwing", () => {
    expect(parseAcquisitionCookie(undefined)).toBeNull()
    expect(parseAcquisitionCookie("")).toBeNull()
    expect(parseAcquisitionCookie("not json")).toBeNull()
    expect(parseAcquisitionCookie('"a string"')).toBeNull()
    expect(parseAcquisitionCookie("[1,2]")).toBeNull()
  })

  it("drops non-string fields and requires at least one channel signal", () => {
    expect(parseAcquisitionCookie(JSON.stringify({ source: 42, landing: "/x" }))).toBeNull()
    const acq = parseAcquisitionCookie(JSON.stringify({ source: "mcp", medium: 7 }))
    expect(acq).toEqual({
      source: "mcp",
      medium: undefined,
      campaign: undefined,
      referrer: undefined,
      landing: undefined,
    })
  })
})
