// STABLE-1: the x402 spend gate — enforcement half.
//
// A 402 carrying an x402 challenge is a demand for money. This turns it into a
// spend decision BEFORE the agent can sign, and — on anything but an approval —
// WITHHOLDS the challenge: an agent that never receives the payment
// requirements cannot construct a payment for them. That is the whole
// enforcement claim, and it is non-custodial: Sanction never holds keys and
// never signs; it decides whether the challenge is allowed to reach the wallet.
//
// The authorizer is injected rather than imported so this stays a pure shell
// over whatever surface calls it (broker today, gateway next) and so the
// enforcement path is unit-testable without a route.
import { parseX402Challenge, priceChallenge, quoteMerchant, quoteSettlement, QUOTE_FAILURE_REASON, type X402Quote } from "@/lib/x402"
import type { Settlement } from "@/lib/settlement"

export type SpendDecision = {
  authorized?: boolean
  status?: string
  code?: string
  reason?: string
  remediation?: string
  request_id?: string
  error?: string
  httpStatus: number
}

export type SpendAuthorizer = (input: {
  amountUsd: number
  merchant: string
  category: string
  description?: string
  settlement: Settlement
}) => Promise<SpendDecision>

export type X402Verdict =
  /** Not an x402 challenge — nothing here for the engine to decide. */
  | { effect: "pass"; rawBody: string }
  /** Approved: the challenge may reach the agent, which signs it itself. */
  | { effect: "allow"; rawBody: string; quote: X402Quote; requestId?: string }
  /** Refused: the caller MUST NOT relay rawBody — that is the enforcement. */
  | { effect: "refuse"; code: string; reason: string; remediation?: string; requestId?: string; status: string; httpStatus: number }

export const X402_CATEGORY = "api"

/** Gate one upstream 402. Consumes the response body; `rawBody` is returned so
 *  the caller can re-emit it on pass/allow (and must not on refuse). */
export async function gateX402Response(res: Response, authorize: SpendAuthorizer, opts?: { description?: string; category?: string }): Promise<X402Verdict> {
  const rawBody = await res.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return { effect: "pass", rawBody }
  }
  const challenge = parseX402Challenge(parsed)
  // A 402 we don't recognize as x402 is passed through untouched: we govern
  // what we can price, and say so rather than pretending to govern everything.
  if (!challenge) return { effect: "pass", rawBody }

  const priced = priceChallenge(challenge)
  if (!priced.ok) {
    return {
      effect: "refuse",
      status: "denied",
      code: priced.reason,
      reason: QUOTE_FAILURE_REASON[priced.reason],
      remediation:
        "Have the operator confirm the asset is a USD-pegged stablecoin Sanction can price, or route this purchase through an explicit /v1/authorize call.",
      httpStatus: 403,
    }
  }

  const quote = priced.quote
  const decision = await authorize({
    amountUsd: quote.amountUsd,
    merchant: quoteMerchant(quote),
    category: opts?.category ?? X402_CATEGORY,
    description: opts?.description ?? quote.description ?? `x402 quote for ${quote.resource ?? quoteMerchant(quote)}`,
    settlement: quoteSettlement(quote),
  })

  if (!decision.authorized) {
    return {
      effect: "refuse",
      status: decision.status ?? "denied",
      code: decision.code ?? "DENIED",
      reason: decision.reason ?? decision.error ?? "Spend not authorized",
      remediation: decision.remediation,
      requestId: decision.request_id,
      httpStatus: decision.httpStatus === 401 ? 401 : 403,
    }
  }

  return { effect: "allow", rawBody, quote, requestId: decision.request_id }
}
