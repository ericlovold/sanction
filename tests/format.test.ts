import { describe, it, expect } from "vitest"
import { fmtUsd, fmtCount } from "../lib/format"

describe("fmtUsd — the one money formatter", () => {
  it("renders ordinary amounts with two decimals and separators", () => {
    expect(fmtUsd(61.9)).toBe("$61.90")
    expect(fmtUsd(1053)).toBe("$1,053.00")
    expect(fmtUsd(0.5)).toBe("$0.50")
  })

  it("keeps four decimals only for sub-cent amounts", () => {
    expect(fmtUsd(0.0042)).toBe("$0.0042")
    expect(fmtUsd(0.009999)).toBe("$0.0100")
  })

  it("a true zero is $0.00, never $0.0000", () => {
    expect(fmtUsd(0)).toBe("$0.00")
  })

  it("negative amounts keep the sign and the same rules", () => {
    expect(fmtUsd(-12.345)).toBe("$-12.35")
    expect(fmtUsd(-0.004)).toBe("$-0.0040")
  })
})

describe("fmtCount", () => {
  it("separates thousands and drops decimals", () => {
    expect(fmtCount(24091000)).toBe("24,091,000")
    expect(fmtCount(31)).toBe("31")
    expect(fmtCount(1234.6)).toBe("1,235")
  })
})
