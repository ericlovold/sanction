import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { authenticateAgent } from "@/lib/auth"
import { POST as authorizeSpendPOST } from "@/app/api/v1/authorize/route"
import { parseX402Challenge, priceChallenge, quoteMerchant, quoteSettlement, QUOTE_FAILURE_REASON } from "@/lib/x402"
import { X402_CATEGORY } from "@/lib/x402Gate"
import { logger } from "@/lib/log"

const log = logger("v1/authorize/quote")

// STABLE-1 (docs/plans/stablecoin-rails.md): authorize an x402 payment
// challenge BEFORE the agent's wallet signs it.
//
// Post the 402 body a resource server just handed you; Sanction prices the
// quote (USD-pegged stablecoins with known decimals only — never a guessed
// rate) and runs it through the SAME spend ladder as any other purchase, by
// calling POST /v1/authorize in-process. So budgets, escalation, grants,
// cascade caps, evidence, and the decision meter all apply unchanged, and the
// decision carries STABLE-0 settlement metadata derived from the quote itself.
//
// This is the cooperative half of the gate: the agent asks. The intercepting
// half lives in the MCP broker, which withholds the challenge outright when a
// brokered upstream demands payment the policy will not allow.
const schema = z.object({
  // The parsed 402 response body: {x402Version, accepts: [...]}.
  challenge: z.unknown(),
  category: z.string().min(1).max(60).optional(),
  description: z.string().max(500).optional(),
  grant_id: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) {
    log.warn("auth failed", { error })
    return NextResponse.json({ error }, { status: 401 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }
  const { challenge: raw, category, description, grant_id } = parsed.data

  const challenge = parseX402Challenge(raw)
  if (!challenge) {
    return NextResponse.json(
      { authorized: false, status: "denied", code: "NOT_X402", reason: QUOTE_FAILURE_REASON.NOT_X402 },
      { status: 400 },
    )
  }

  const priced = priceChallenge(challenge)
  if (!priced.ok) {
    // A pre-ladder refusal: the engine never ran, so nothing is persisted and
    // nothing is metered — but the agent gets a stable code to replan on.
    log.info("quote not priceable", { agentId: agent.id, reason: priced.reason })
    return NextResponse.json(
      {
        authorized: false,
        status: "denied",
        code: priced.reason,
        reason: QUOTE_FAILURE_REASON[priced.reason],
        remediation:
          "Sanction prices only USD-pegged stablecoin quotes with known decimals. Authorize this purchase explicitly via POST /v1/authorize if the amount is known.",
      },
      { status: 403 },
    )
  }

  const quote = priced.quote
  const settlement = quoteSettlement(quote)
  const idempotencyKey = req.headers.get("idempotency-key")

  const decisionRes = await authorizeSpendPOST(
    new NextRequest("https://quote.internal/api/v1/authorize", {
      method: "POST",
      headers: {
        "x-api-key": req.headers.get("x-api-key") ?? "",
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        action: "purchase",
        amount_usd: quote.amountUsd,
        merchant: quoteMerchant(quote),
        category: category ?? X402_CATEGORY,
        description: description ?? quote.description ?? `x402 quote for ${quote.resource ?? quoteMerchant(quote)}`,
        settlement,
        ...(grant_id ? { grant_id } : {}),
      }),
    }),
  )

  const decision = (await decisionRes.json()) as Record<string, unknown>
  // Echo the priced quote so the caller can see exactly what was authorized —
  // the worst-case amount across the challenge's options, not a guess.
  return NextResponse.json(
    {
      ...decision,
      quote: {
        amount_usd: quote.amountUsd,
        amount_atomic: quote.amountAtomic,
        asset: quote.asset,
        network: quote.network,
        pay_to: quote.payTo,
        resource: quote.resource,
        scheme: quote.scheme,
      },
      settlement,
    },
    { status: decisionRes.status },
  )
}
