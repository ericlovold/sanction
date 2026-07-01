import { describe, it, expect } from "vitest"
import { evaluate, allow, type Rule, type Obligation } from "../lib/evaluation"

type C = Record<string, never>
const ctx: C = {}

const deny = (id: string, code: string): Rule<C> => ({ id, run: () => ({ effect: "deny", ruleId: id, code, reason: `${id} denied` }) })
const escalate = (id: string, obl?: Obligation[]): Rule<C> => ({ id, run: () => ({ effect: "escalate", ruleId: id, reason: `${id} escalated`, obligations: obl }) })
const pass = (id: string, obl?: Obligation[]): Rule<C> => ({ id, run: () => allow(id, undefined, obl) })

const AUDIT: Obligation = { type: "audit_log", enforcement: "advisory", event: "x" }
const RESERVE: Obligation = { type: "reserve_budget", enforcement: "required", scope: "agent", amountCents: 100 }

describe("evaluate — combining", () => {
  it("all allow → allow, accumulating obligations from surviving rules", () => {
    const d = evaluate(ctx, [pass("a", [AUDIT]), pass("b"), pass("c", [RESERVE])])
    expect(d.effect).toBe("allow")
    expect(d.ruleId).toBe("c") // terminal rule
    expect(d.obligations).toEqual([AUDIT, RESERVE])
  })

  it("first deny wins and short-circuits, discarding obligations", () => {
    const d = evaluate(ctx, [pass("a", [AUDIT]), deny("b", "B_CODE"), deny("c", "C_CODE")])
    expect(d.effect).toBe("deny")
    expect(d.ruleId).toBe("b")
    expect(d.code).toBe("B_CODE")
    expect(d.obligations).toEqual([]) // a deny carries none
  })

  it("deny before an escalate wins (ordered deny-overrides)", () => {
    const d = evaluate(ctx, [deny("a", "A"), escalate("b")])
    expect(d.effect).toBe("deny")
    expect(d.ruleId).toBe("a")
  })

  it("escalate wins when no earlier deny, carrying its own obligations only", () => {
    const d = evaluate(ctx, [pass("a", [AUDIT]), escalate("b", [RESERVE])])
    expect(d.effect).toBe("escalate")
    expect(d.ruleId).toBe("b")
    expect(d.obligations).toEqual([RESERVE]) // earlier allow obligations discarded
  })

  it("empty rule set → default allow", () => {
    expect(evaluate(ctx, []).effect).toBe("allow")
  })
})
