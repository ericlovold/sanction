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
import { TOOL_RULES, type ToolContext } from "@/lib/rules/tool"
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
}

function toLayer(walletId: string, p: LeafPolicy): PolicyLayer {
  return {
    walletId,
    revision: p.currentRevision,
    blockedTools: p.blockedTools,
    allowedTools: p.allowedTools,
    escalateTools: p.escalateTools,
    capabilityRules: parseCapabilityRules(p.capabilityRules),
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

/** Decide a tool invocation across every policy layer. Pure. */
export function decideToolLayered(tool: string, layers: PolicyLayer[]): LayeredOutcome {
  const verdicts = layers.map((layer) => {
    const ctx: ToolContext = {
      tool,
      blockedTools: layer.blockedTools,
      allowedTools: layer.allowedTools,
      escalateTools: layer.escalateTools,
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
