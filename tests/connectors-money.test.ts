// Money for provider usage: integer nano-dollars, no float arithmetic. The
// property tests draw random decimals from a seeded generator, so a failure
// reproduces from the seed.

import { describe, expect, it } from "vitest"
import { nanosToDecimal, nanosToUsd, sumNanos, toNanos, usd } from "../lib/connectors/money"

// mulberry32: small, deterministic, good enough to pick digits.
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomDecimal(rand: () => number, maxFractionDigits: number): string {
  const whole = Math.floor(rand() * 1_000_000)
  const places = Math.floor(rand() * (maxFractionDigits + 1))
  let fraction = ""
  for (let i = 0; i < places; i++) fraction += Math.floor(rand() * 10)
  fraction = fraction.replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : String(whole)
}

describe("toNanos", () => {
  it("reads the provider formats exactly", () => {
    // Cursor: fractional cents as a JSON number.
    expect(toNanos(21.36232, "cents")).toBe(BigInt(213_623_200))
    expect(toNanos(2450.125487, "cents")).toBe(BigInt("24501254870"))
    // Anthropic: cents as a decimal string with six decimals ($412.80).
    expect(toNanos("41280.000000", "cents")).toBe(BigInt("412800000000"))
    // OpenAI: a USD value.
    expect(toNanos(0.06, "usd")).toBe(BigInt(60_000_000))
    expect(toNanos("0", "usd")).toBe(BigInt(0))
  })

  it("does not inherit float error: 0.1 + 0.2 cents is exactly 0.3 cents", () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(toNanos(0.1, "cents") + toNanos(0.2, "cents")).toBe(toNanos(0.3, "cents"))
  })

  it("handles exponent notation, which String() emits for small and large numbers", () => {
    expect(toNanos(1e-7, "usd")).toBe(BigInt(100))
    expect(toNanos("1.5e3", "cents")).toBe(BigInt("15000000000"))
    expect(toNanos(1e-300, "usd")).toBe(BigInt(0))
    expect(toNanos("1e-500", "usd")).toBe(BigInt(0))
    expect(toNanos("1." + "0".repeat(410), "usd")).toBe(usd(1))
  })

  it("rounds digits finer than a nano-dollar half away from zero", () => {
    expect(toNanos("0.0000000004", "usd")).toBe(BigInt(0))
    expect(toNanos("0.0000000005", "usd")).toBe(BigInt(1))
    expect(toNanos("-0.0000000005", "usd")).toBe(BigInt(-1))
  })

  it("keeps credits negative", () => {
    expect(toNanos(-12.5, "cents")).toBe(BigInt(-125_000_000))
    expect(toNanos("+3", "usd")).toBe(usd(3))
  })

  it("refuses anything that is not a plain decimal, instead of storing zero", () => {
    for (const bad of ["", "abc", "1,000", "$5", "0x10", "1.2.3", "NaN", "Infinity", " "]) {
      expect(() => toNanos(bad, "usd"), bad).toThrow()
    }
    expect(() => toNanos(Number.NaN, "cents")).toThrow()
    expect(() => toNanos(Number.POSITIVE_INFINITY, "cents")).toThrow()
    expect(() => toNanos("1e99999", "usd")).toThrow()
    expect(() => toNanos("1e60", "usd")).toThrow()
    expect(() => toNanos("99999999999", "usd")).toThrow()
  })
})

describe("properties", () => {
  it("decimal string to nanos and back is the identity (cents to 7 places, dollars to 9)", () => {
    const rand = prng(20261123)
    for (let i = 0; i < 2000; i++) {
      const cents = randomDecimal(rand, 7)
      expect(nanosToDecimal(toNanos(cents, "cents"), "cents")).toBe(cents)
      const dollars = randomDecimal(rand, 9)
      expect(nanosToDecimal(toNanos(dollars, "usd"), "usd")).toBe(dollars)
    }
  })

  it("a JSON number converts the same as the decimal text the provider wrote", () => {
    const rand = prng(7)
    for (let i = 0; i < 2000; i++) {
      const text = randomDecimal(rand, 6) // Cursor documents six decimals of a cent
      expect(toNanos(JSON.parse(text) as number, "cents")).toBe(toNanos(text, "cents"))
    }
  })

  it("the sum of converted rows equals the conversion of the exact sum", () => {
    const rand = prng(99)
    for (let round = 0; round < 50; round++) {
      const rows = Array.from({ length: 200 }, () => randomDecimal(rand, 7))
      const nanos = sumNanos(rows.map((r) => toNanos(r, "cents")))
      // Exact reference: add as integers of 1e-7 cents.
      const reference = rows.reduce((sum, r) => {
        const [whole, fraction = ""] = r.split(".")
        return sum + BigInt(whole + fraction.padEnd(7, "0"))
      }, BigInt(0))
      expect(nanos).toBe(reference)
    }
  })

  it("cents and dollars agree: x cents is x/100 dollars", () => {
    const rand = prng(3)
    for (let i = 0; i < 500; i++) {
      const whole = Math.floor(rand() * 1_000_000)
      expect(toNanos(String(whole), "cents") * BigInt(100)).toBe(toNanos(String(whole), "usd"))
    }
  })
})

describe("display helpers", () => {
  it("renders exact decimals and display dollars", () => {
    expect(nanosToDecimal(BigInt(0), "usd")).toBe("0")
    expect(nanosToDecimal(BigInt(-1_500_000_000), "usd")).toBe("-1.5")
    expect(nanosToDecimal(BigInt(213_623_200), "cents")).toBe("21.36232")
    expect(nanosToUsd(usd(140))).toBe(140)
    expect(() => usd(1.5)).toThrow()
  })
})
