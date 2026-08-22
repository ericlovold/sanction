// STABLE-1 (docs/plans/stablecoin-rails.md): the x402 spend gate — pure half.
//
// x402 turns HTTP 402 into a machine payment handshake: a resource server
// answers 402 with `{x402Version, error, accepts: [...]}`, the client signs a
// stablecoin transfer for one of the `accepts` entries and retries with the
// payment attached. Settlement is irreversible, so the ONLY control point is
// the moment between receiving the challenge and signing it. This module turns
// a challenge into a priced spend request the existing ladder can decide.
//
// Two rules make this deterministic and safe:
//
//  1. NO ORACLE, NO FX. A quote is priced only when its asset is a USD-pegged
//     stablecoin with known decimals from the registry below. Anything else is
//     NOT priceable and the gate DENIES rather than guessing — a decision must
//     never depend on a rate we looked up at decision time (ADR-0009).
//  2. WORST CASE WINS. `accepts` may offer several ways to pay and the client
//     picks one; Sanction cannot know which. So the authorized amount is the
//     MAXIMUM across the offered entries, and a challenge containing even one
//     unpriceable entry is unpriceable as a whole — the client could have
//     chosen exactly that one.
//
// Nothing here does IO. The shell prices the challenge, then runs the same
// /v1/authorize ladder any other spend goes through.
import type { Settlement } from "@/lib/settlement"

/** Assets we can price 1:1 in USD, keyed `<network>:<lowercased address>`.
 *  USD-pegged only: EURC and friends would need an FX rate at decision time,
 *  which the determinism contract forbids. Verified 2026-08-22: native USDC on
 *  Base is 0x8335…2913 with 6 decimals (Circle). Add entries only with the
 *  issuer's published address — a wrong row here misprices real money. */
const USD_PEGGED: Record<string, { symbol: "usdc"; decimals: number }> = {
  "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "usdc", decimals: 6 },
}

/** x402 networks we map onto the settlement vocabulary (lib/settlement.ts). */
const NETWORKS: Record<string, Settlement["network"]> = {
  base: "base",
  ethereum: "ethereum",
  solana: "solana",
  polygon: "polygon",
  arbitrum: "arbitrum",
  optimism: "optimism",
}

export type X402Accept = {
  scheme?: unknown
  network?: unknown
  maxAmountRequired?: unknown
  resource?: unknown
  description?: unknown
  payTo?: unknown
  asset?: unknown
}

export type X402Challenge = { version: number; accepts: X402Accept[] }

export type X402Quote = {
  /** Worst-case cost of this challenge, in dollars. */
  amountUsd: number
  /** The winning entry's raw atomic amount, kept for evidence. */
  amountAtomic: string
  asset: string
  network: Settlement["network"]
  payTo: string
  resource?: string
  description?: string
  scheme: string
}

export type QuoteFailure = "NOT_X402" | "QUOTE_NOT_PRICEABLE" | "QUOTE_MALFORMED"

/** Shape-check a 402 body as an x402 payment-required response. */
export function parseX402Challenge(body: unknown): X402Challenge | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, unknown>
  const version = b.x402Version
  if (typeof version !== "number") return null
  if (!Array.isArray(b.accepts) || b.accepts.length === 0) return null
  return { version, accepts: b.accepts as X402Accept[] }
}

function priceOne(a: X402Accept): { cents: number; quote: X402Quote } | null {
  const network = typeof a.network === "string" ? NETWORKS[a.network.toLowerCase()] : undefined
  const asset = typeof a.asset === "string" ? a.asset : undefined
  const payTo = typeof a.payTo === "string" ? a.payTo : undefined
  const amount = typeof a.maxAmountRequired === "string" ? a.maxAmountRequired : undefined
  if (!network || !asset || !payTo || !amount) return null
  if (!/^\d+$/.test(amount)) return null

  const known = USD_PEGGED[`${network}:${asset.toLowerCase()}`]
  if (!known) return null

  // Atomic units → cents in integer math (no float rounding on money), then
  // dollars for the ladder, which speaks dollars at the API edge.
  const atomic = BigInt(amount)
  const scale = BigInt(10) ** BigInt(known.decimals)
  const cents = Number((atomic * BigInt(100)) / scale)
  if (!Number.isFinite(cents)) return null

  return {
    cents,
    quote: {
      amountUsd: cents / 100,
      amountAtomic: amount,
      asset,
      network,
      payTo,
      resource: typeof a.resource === "string" ? a.resource : undefined,
      description: typeof a.description === "string" ? a.description : undefined,
      scheme: typeof a.scheme === "string" ? a.scheme : "exact",
    },
  }
}

/** Price a challenge at its worst case. One unpriceable entry poisons the
 *  whole challenge: the client could have picked exactly that one. */
export function priceChallenge(challenge: X402Challenge): { ok: true; quote: X402Quote } | { ok: false; reason: QuoteFailure } {
  let worst: { cents: number; quote: X402Quote } | null = null
  for (const a of challenge.accepts) {
    const priced = priceOne(a)
    if (!priced) return { ok: false, reason: "QUOTE_NOT_PRICEABLE" }
    if (!worst || priced.cents > worst.cents) worst = priced
  }
  if (!worst) return { ok: false, reason: "QUOTE_MALFORMED" }
  return { ok: true, quote: worst.quote }
}

/** The merchant a quote is charged against: the resource's host when it gives
 *  one (what an operator recognizes in an audit row), else the payee address. */
export function quoteMerchant(quote: X402Quote): string {
  if (quote.resource) {
    try {
      return new URL(quote.resource).host
    } catch {
      /* resource may be a bare path — fall through to the payee */
    }
  }
  return quote.payTo
}

/** The settlement metadata (STABLE-0) a priced quote implies. */
export function quoteSettlement(quote: X402Quote): Settlement {
  return { rail: "x402", asset: "usdc", network: quote.network }
}

/** Human-readable reason for a refusal, for the agent's replan path. */
export const QUOTE_FAILURE_REASON: Record<QuoteFailure, string> = {
  NOT_X402: "Payment required, but the challenge is not an x402 payment-required response",
  QUOTE_MALFORMED: "x402 challenge carried no usable payment requirement",
  QUOTE_NOT_PRICEABLE:
    "x402 quote could not be priced in USD — Sanction authorizes only USD-pegged stablecoin quotes with known decimals, and never guesses a rate",
}
