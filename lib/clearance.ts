// Pure clearance logic, shared by the clearance-assignment endpoint, /exec, and
// their tests. DB-free so the rules can be unit-tested in isolation.
//
// Clearance is a 1-5 level plus an industry domain (model AgentClearance). The
// brand promise is "agents only access what they're cleared for" — this module
// turns that from modeled-only data into an enforced gate.

export const INDUSTRIES = ["general", "healthcare", "legal", "financial", "enterprise"] as const
export type Industry = (typeof INDUSTRIES)[number]

export const MIN_CLEARANCE = 1
export const MAX_CLEARANCE = 5

export function isValidLevel(level: number): boolean {
  return Number.isInteger(level) && level >= MIN_CLEARANCE && level <= MAX_CLEARANCE
}

export function isValidIndustry(industry: string): industry is Industry {
  return (INDUSTRIES as readonly string[]).includes(industry)
}

// A credential may declare the minimum clearance required to access it via a
// conventional scope tag `clearance:N` in its `scopes` array (an existing field —
// "what this credential grants"). No tag, or an unparseable one, means the
// credential carries no clearance requirement (level 1 / open to any cleared
// agent), which preserves backward compatibility for existing vault entries.
const CLEARANCE_TAG = /^clearance:(\d+)$/

export function requiredClearance(scopes: string[]): number {
  let max = MIN_CLEARANCE
  for (const s of scopes) {
    const m = CLEARANCE_TAG.exec(s.trim())
    if (m) {
      const n = Number(m[1])
      if (Number.isInteger(n) && n > max) max = n
    }
  }
  return max
}

// True when an agent at `agentLevel` is cleared for a credential requiring
// `required`. Clearance is hierarchical: a higher level satisfies a lower one.
export function isClearedFor(agentLevel: number, required: number): boolean {
  return agentLevel >= required
}

export type ClearanceGateInput = {
  label: string
  scopes: string[]
}

// Given the agent's clearance level and the credentials it requested, return the
// labels it is NOT cleared for (required clearance exceeds the agent's level).
export function clearanceDenials(agentLevel: number, credentials: ClearanceGateInput[]): string[] {
  return credentials
    .filter((c) => !isClearedFor(agentLevel, requiredClearance(c.scopes)))
    .map((c) => c.label)
}
