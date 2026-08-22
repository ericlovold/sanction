// STABLE-0 (docs/plans/stablecoin-rails.md): optional settlement metadata on
// spend authorizations — which rail the approved spend will settle on. A
// closed, typed vocabulary (never free text): closed = simulable,
// documentable, and immune to junk drifting into evidence. Like attribution
// tags, settlement is INERT to the decision itself — rules never read it
// (determinism: same request + policy ⇒ same outcome) — it rides the
// persisted row so the ledger and audit trail are rail-aware before any
// rail-specific enforcement exists. Sanction authorizes the spend; any rail
// settles it.
import { z } from "zod"

export const SETTLEMENT_RAILS = ["card", "ach", "wire", "x402", "internal"] as const
export const SETTLEMENT_ASSETS = ["usd", "usdc", "eurc", "usdt"] as const
export const SETTLEMENT_NETWORKS = ["base", "ethereum", "solana", "polygon", "arbitrum", "optimism"] as const

export const settlementSchema = z
  .object({
    rail: z.enum(SETTLEMENT_RAILS),
    asset: z.enum(SETTLEMENT_ASSETS).optional(),
    network: z.enum(SETTLEMENT_NETWORKS).optional(),
  })
  // A chain network only means something on the onchain rail; recording
  // "card + base" would be evidence that lies.
  .refine((s) => !s.network || s.rail === "x402", {
    message: "network applies only to rail \"x402\"",
    path: ["network"],
  })

export type Settlement = z.infer<typeof settlementSchema>
