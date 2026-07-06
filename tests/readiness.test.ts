import { describe, it, expect } from "vitest"
import { scoreReadiness, LEVELS } from "@/lib/readiness"
import { findPack } from "@/lib/policyPacks"

describe("scoreReadiness — level", () => {
  it("unsure usage is Level 0 (Shadow AI)", () => {
    const r = scoreReadiness({ environment: "other", activities: ["unsure"], data: ["internal"], approvals: [] })
    expect(r.level).toBe(0)
    expect(r.levelName).toBe("Shadow AI")
  })

  it("drafting/retrieval only is Level 1 (Assisted)", () => {
    const r = scoreReadiness({ environment: "law", activities: ["drafting", "retrieval"], data: ["internal"], approvals: [] })
    expect(r.level).toBe(1)
  })

  it("any acting capability is Level 2 (Tool-Using)", () => {
    const r = scoreReadiness({ environment: "dev", activities: ["drafting", "tools"], data: ["internal"], approvals: [] })
    expect(r.level).toBe(2)
  })
})

describe("scoreReadiness — risk map", () => {
  it("credential exposure outranks everything and drives the first workflow", () => {
    const r = scoreReadiness({
      environment: "dev",
      activities: ["tools", "credentials", "spend"],
      data: ["secrets", "internal"],
      approvals: [],
    })
    expect(r.risks[0].title).toBe("Credential exposure")
    expect(r.firstWorkflow).toContain("scoped execution grant")
  })

  it("clinic + PHI + tools surfaces the PHI risk at full weight", () => {
    const r = scoreReadiness({ environment: "clinic", activities: ["tools"], data: ["phi"], approvals: [] })
    expect(r.risks[0].title).toBe("PHI in tool-using AI")
  })

  it("returns at most 3 risks, highest weight first", () => {
    const r = scoreReadiness({
      environment: "law",
      activities: ["tools", "external_send", "credentials", "spend", "write_systems"],
      data: ["client", "privileged", "secrets"],
      approvals: [],
    })
    expect(r.risks).toHaveLength(3)
    expect(r.risks[0].weight).toBeGreaterThanOrEqual(r.risks[2].weight)
  })

  it("drafting-only still returns a risk (authority creep), never an empty map", () => {
    const r = scoreReadiness({ environment: "other", activities: ["drafting"], data: ["public"], approvals: [] })
    expect(r.risks.length).toBeGreaterThan(0)
  })
})

describe("scoreReadiness — posture and pack", () => {
  it("recommended pack ids all exist in lib/policyPacks", () => {
    const inputs = [
      { environment: "clinic", activities: ["tools"], data: ["phi"], approvals: [] },
      { environment: "agency", activities: ["tools"], data: ["internal"], approvals: [] },
      { environment: "dev", activities: ["spend"], data: ["internal"], approvals: [] },
      { environment: "other", activities: ["drafting"], data: ["public"], approvals: [] },
    ] as const
    for (const i of inputs) {
      const r = scoreReadiness({ ...i, activities: [...i.activities], data: [...i.data], approvals: [...i.approvals] })
      expect(findPack(r.packId), r.packId).not.toBeNull()
    }
  })

  it("regulated data lands on the compliance baseline pack", () => {
    const r = scoreReadiness({ environment: "finance", activities: ["tools"], data: ["financial"], approvals: [] })
    expect(r.packId).toBe("compliance-baseline")
  })

  it("credential denial is always in the posture", () => {
    const r = scoreReadiness({ environment: "other", activities: ["drafting"], data: ["public"], approvals: [] })
    expect(r.posture.deny.some((d) => d.includes("Credential"))).toBe(true)
  })

  it("law + privileged data recommends Sanction Local", () => {
    const r = scoreReadiness({ environment: "law", activities: ["retrieval", "tools"], data: ["privileged"], approvals: [] })
    expect(r.fit.primary).toBe("Sanction Local")
  })

  it("dev teams get the MCP fit", () => {
    const r = scoreReadiness({ environment: "dev", activities: ["tools"], data: ["internal"], approvals: [] })
    expect(r.fit.primary).toBe("Sanction MCP")
  })

  it("regulated evidence adds the assessor-ready export line", () => {
    const r = scoreReadiness({ environment: "clinic", activities: ["tools"], data: ["phi"], approvals: [] })
    expect(r.posture.evidence.some((e) => e.includes("Assessor-ready"))).toBe(true)
  })
})

describe("LEVELS ladder", () => {
  it("has six levels, 0 through 5", () => {
    expect(LEVELS).toHaveLength(6)
    expect(LEVELS[3].name).toBe("Governed AI")
  })
})
