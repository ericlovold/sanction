import { describe, expect, it } from "vitest"

import { parseOwnerEmail, parsePoolCapDollars, parsePoolName } from "../lib/poolForms"

function expectInvalid(result: { ok: true } | { ok: false; error: string }) {
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toEqual(expect.any(String))
}

describe("parsePoolCapDollars", () => {
  it("converts nonnegative dollar inputs to cents", () => {
    expect(parsePoolCapDollars("0")).toEqual({ ok: true, cents: 0 })
    expect(parsePoolCapDollars("12")).toEqual({ ok: true, cents: 1200 })
    expect(parsePoolCapDollars("12.34")).toEqual({ ok: true, cents: 1234 })
    expect(parsePoolCapDollars("12.3")).toEqual({ ok: true, cents: 1230 })
    expect(parsePoolCapDollars(" 0.01 ")).toEqual({ ok: true, cents: 1 })
  })

  it("clears the cap for blank and null inputs", () => {
    expect(parsePoolCapDollars("")).toEqual({ ok: true, cents: null })
    expect(parsePoolCapDollars("   ")).toEqual({ ok: true, cents: null })
    expect(parsePoolCapDollars(null)).toEqual({ ok: true, cents: null })
  })

  it("rejects negative and non-number caps", () => {
    expectInvalid(parsePoolCapDollars("-1"))
    expectInvalid(parsePoolCapDollars("-0.01"))
    expectInvalid(parsePoolCapDollars("abc"))
    expectInvalid(parsePoolCapDollars("12 dollars"))
  })
})

describe("parsePoolName", () => {
  it("trims and accepts names from 1 to 80 characters", () => {
    expect(parsePoolName("  Growth pool  ")).toEqual({
      ok: true,
      name: "Growth pool",
    })
    expect(parsePoolName("x".repeat(80))).toEqual({
      ok: true,
      name: "x".repeat(80),
    })
  })

  it("rejects blank and overlong names", () => {
    expectInvalid(parsePoolName(""))
    expectInvalid(parsePoolName("   "))
    expectInvalid(parsePoolName("x".repeat(81)))
  })
})

describe("parseOwnerEmail", () => {
  it("trims and lowercases valid emails", () => {
    expect(parseOwnerEmail("  Owner@Example.COM  ")).toEqual({
      ok: true,
      email: "owner@example.com",
    })
  })

  it("rejects invalid emails", () => {
    expectInvalid(parseOwnerEmail(""))
    expectInvalid(parseOwnerEmail("owner"))
    expectInvalid(parseOwnerEmail("owner@example"))
    expectInvalid(parseOwnerEmail("owner example.com"))
  })
})
