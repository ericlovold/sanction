import { describe, it, expect } from "vitest"
import {
  isValidLevel,
  isValidIndustry,
  requiredClearance,
  isClearedFor,
  clearanceDenials,
  INDUSTRIES,
} from "../lib/clearance"

describe("clearance validation", () => {
  it("accepts levels 1-5 only", () => {
    expect(isValidLevel(1)).toBe(true)
    expect(isValidLevel(5)).toBe(true)
    expect(isValidLevel(0)).toBe(false)
    expect(isValidLevel(6)).toBe(false)
    expect(isValidLevel(2.5)).toBe(false)
  })

  it("accepts only known industries", () => {
    for (const ind of INDUSTRIES) expect(isValidIndustry(ind)).toBe(true)
    expect(isValidIndustry("aerospace")).toBe(false)
    expect(isValidIndustry("")).toBe(false)
  })
})

describe("requiredClearance (clearance:N scope tag)", () => {
  it("defaults to 1 when no tag is present", () => {
    expect(requiredClearance([])).toBe(1)
    expect(requiredClearance(["read", "write"])).toBe(1)
  })

  it("parses the clearance tag", () => {
    expect(requiredClearance(["clearance:3"])).toBe(3)
    expect(requiredClearance(["read", "clearance:4", "write"])).toBe(4)
  })

  it("takes the highest tag when multiple are present", () => {
    expect(requiredClearance(["clearance:2", "clearance:5", "clearance:1"])).toBe(5)
  })

  it("ignores unparseable tags", () => {
    expect(requiredClearance(["clearance:x", "clearance:"])).toBe(1)
  })
})

describe("isClearedFor (hierarchical)", () => {
  it("higher level satisfies a lower requirement", () => {
    expect(isClearedFor(5, 3)).toBe(true)
    expect(isClearedFor(3, 3)).toBe(true)
    expect(isClearedFor(2, 3)).toBe(false)
  })
})

describe("clearanceDenials", () => {
  const creds = [
    { label: "open-key", scopes: [] },
    { label: "phi-db", scopes: ["clearance:4"] },
    { label: "prod-deploy", scopes: ["clearance:3", "deploy"] },
  ]

  it("returns labels the agent is not cleared for", () => {
    expect(clearanceDenials(3, creds)).toEqual(["phi-db"])
  })

  it("returns nothing when fully cleared", () => {
    expect(clearanceDenials(5, creds)).toEqual([])
  })

  it("a level-1 agent is denied any tagged credential", () => {
    expect(clearanceDenials(1, creds)).toEqual(["phi-db", "prod-deploy"])
  })
})
