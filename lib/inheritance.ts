// INHERIT-1: policy inheritance down the wallet tree — slice 1 (tool +
// capability ladders). Design: docs/plans/policy-inheritance.md.
//
// Budgets cascade through counters; RULES inherit here, at evaluation time,
// as an overlay — no copy-down, no sync jobs, every wallet keeps its own
// revision chain. The semantics are "a child may tighten, never loosen":
//
//   - Each ancestor policy is evaluated INDEPENDENTLY through the existing
//     pure ladder, then the per-layer verdicts fold deny > escalate > allow.
//     Any layer's block stands. Any layer's escalate stands unless a block
//     beats it. Allow requires every layer to allow.
//   - Root-most attribution: when two layers object, the decision names the
//     one closest to the root — "the org forbade it", not the leaf echo.
//   - Deliberately NOT a concat of rule lists: merging lists would let a
//     permissive ancestor (`allow *`) satisfy a child's strict allow-list
//     mention check and silently widen it. Per-layer evaluation preserves
//     each policy's internal semantics exactly.
//
// Pure over its inputs (ADR-0009): the fold does no IO. policyLayerChain is
// the shell-side fetch that assembles the layers — leaf from data the route
// already holds (zero extra queries for a parentless wallet), ancestors
// walked iteratively like walletAncestorChain.

import { evaluate } from "@/lib/evaluation"
import { TOOL_RULES, type ToolContext, type ToolConditionRule } from "@/lib/rules/tool"
import {
  CAPABILITY_RULES,
  parseCapabilityRules,
  type CapabilityContext,
  type CapabilityRule,
} from "@/lib/capability"

export type PolicyLayer = {
  walletId: string
  revision: number
  blockedTools: string[]
  allowedTools: string[]
  escalateTools: string[]
  capabilityRules: CapabilityRule[]
  toolConditions: ToolConditionRule[]
}

/** Signals the shell supplies once per request — never read inside rules. */
export type ToolSignals = { requestHourUtc?: number; modelCallsToday?: number }

/** Parse a Policy.toolConditions Json column (bad entries dropped, like
 * parseCapabilityRules — the write path validates, the read path tolerates). */
export function parseToolConditions(value: unknown): ToolConditionRule[] {
  if (!Array.isArray(value)) return []
  const out: ToolConditionRule[] = []
  for (const v of value) {
    const r = v as ToolConditionRule
    if (!r || typeof r !== "object" || typeof r.pattern !== "string" || r.pattern.length === 0) continue
    if (r.effect !== "block" && r.effect !== "escalate") continue
    const w = r.when
    if (!w || typeof w !== "object") continue
    const hours = Array.isArray(w.outside_hours_utc) && w.outside_hours_utc.length === 2 &&
      w.outside_hours_utc.every((h) => Number.isInteger(h) && h >= 0 && h <= 23)
    const calls = typeof w.after_model_calls_today === "number" && Number.isInteger(w.after_model_calls_today) && w.after_model_calls_today >= 1
    if (Number(!!hours) + Number(!!calls) !== 1) continue
    out.push({ pattern: r.pattern, effect: r.effect, when: hours ? { outside_hours_utc: [w.outside_hours_utc![0], w.outside_hours_utc![1]] } : { after_model_calls_today: w.after_model_calls_today } })
  }
  return out
}

export type ConsultedRevision = { wallet_id: string; revision: number }

export type LayeredOutcome = {
  effect: "allow" | "deny" | "escalate"
  code?: string
  reason?: string
  /** The layer whose verdict won (root-most objector; the leaf on allow). */
  decidedBy: PolicyLayer
  /** Every policy revision consulted, root→leaf — the evidence trail. */
  consulted: ConsultedRevision[]
}

// Deliberately duck-typed (like CascadeTx) so both PrismaClient and a
// transaction client — and unit-test mocks — satisfy it.
type LayerTx = {
  wallet: {
    findUnique(args: {
      where: { id: string }
      select: {
        id: true
        parentId: true
        policy: {
          select: {
            currentRevision: true
            blockedTools: true
            allowedTools: true
            escalateTools: true
            capabilityRules: true
            toolConditions: true
          }
        }
      }
    }): Promise<{
      id: string
      parentId: string | null
      policy: {
        currentRevision: number
        blockedTools: string[]
        allowedTools: string[]
        escalateTools: string[]
        capabilityRules: unknown
        toolConditions: unknown
      } | null
    } | null>
  }
}

const MAX_ANCESTOR_DEPTH = 20

type LeafPolicy = {
  currentRevision: number
  blockedTools: string[]
  allowedTools: string[]
  escalateTools: string[]
  capabilityRules: unknown
  toolConditions?: unknown
}

function toLayer(walletId: string, p: LeafPolicy): PolicyLayer {
  return {
    walletId,
    revision: p.currentRevision,
    blockedTools: p.blockedTools,
    allowedTools: p.allowedTools,
    escalateTools: p.escalateTools,
    capabilityRules: parseCapabilityRules(p.capabilityRules),
    toolConditions: parseToolConditions(p.toolConditions),
  }
}

/**
 * Assemble the policy layers root→leaf. The leaf comes from data the caller
 * already holds (agent.wallet + its policy), so a parentless wallet costs
 * zero queries. Ancestors without a policy contribute no layer — no policy,
 * no constraints. Cycle- and depth-guarded like walletAncestorChain.
 */
export async function policyLayerChain(
  tx: LayerTx,
  leaf: { id: string; parentId: string | null; policy: LeafPolicy },
): Promise<PolicyLayer[]> {
  const layers: PolicyLayer[] = [toLayer(leaf.id, leaf.policy)]
  const seen = new Set<string>([leaf.id])
  let cur = leaf.parentId

  for (let depth = 0; cur && depth < MAX_ANCESTOR_DEPTH; depth++) {
    if (seen.has(cur)) break
    seen.add(cur)
    const wallet = await tx.wallet.findUnique({
      where: { id: cur },
      select: {
        id: true,
        parentId: true,
        policy: {
          select: {
            currentRevision: true,
            blockedTools: true,
            allowedTools: true,
            escalateTools: true,
            capabilityRules: true,
            toolConditions: true,
          },
        },
      },
    })
    if (!wallet) break
    if (wallet.policy) layers.push(toLayer(wallet.id, wallet.policy))
    cur = wallet.parentId
  }

  return layers.reverse() // root→leaf
}

type LayerVerdict = { layer: PolicyLayer; effect: "allow" | "deny" | "escalate"; code?: string; reason?: string }

// deny > escalate > allow across layers; root-most objector wins attribution.
// Layers arrive root→leaf, so the first matching verdict is root-most.
function fold(verdicts: LayerVerdict[], consulted: ConsultedRevision[]): LayeredOutcome {
  const winner =
    verdicts.find((v) => v.effect === "deny") ??
    verdicts.find((v) => v.effect === "escalate") ??
    verdicts[verdicts.length - 1] // all allowed — the leaf's own verdict
  return { effect: winner.effect, code: winner.code, reason: winner.reason, decidedBy: winner.layer, consulted }
}

/** Decide a tool invocation across every policy layer. Pure — signals are
 * whatever the shell captured once for this request (COND-1). */
export function decideToolLayered(tool: string, layers: PolicyLayer[], signals: ToolSignals = {}): LayeredOutcome {
  const verdicts = layers.map((layer) => {
    const ctx: ToolContext = {
      tool,
      blockedTools: layer.blockedTools,
      allowedTools: layer.allowedTools,
      escalateTools: layer.escalateTools,
      conditions: layer.toolConditions,
      requestHourUtc: signals.requestHourUtc,
      modelCallsToday: signals.modelCallsToday,
    }
    const d = evaluate(ctx, TOOL_RULES)
    return { layer, effect: d.effect, code: d.code, reason: d.reason }
  })
  return fold(verdicts, layers.map((l) => ({ wallet_id: l.walletId, revision: l.revision })))
}

/** Decide a capability acquisition across every policy layer. Pure. */
export function decideCapabilityLayered(capability: string, layers: PolicyLayer[]): LayeredOutcome {
  const verdicts = layers.map((layer) => {
    const ctx: CapabilityContext = { capability, rules: layer.capabilityRules }
    const d = evaluate(ctx, CAPABILITY_RULES)
    return { layer, effect: d.effect, code: d.code, reason: d.reason }
  })
  return fold(verdicts, layers.map((l) => ({ wallet_id: l.walletId, revision: l.revision })))
}
