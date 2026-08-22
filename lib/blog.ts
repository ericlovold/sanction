// Product blog. Add a new post to the array to publish — order in the file
// doesn't matter; `allPosts()` sorts by date descending. `body` is markdown
// (rendered with the shared <Markdown> component, same as the changelog).
// Keep dates ISO (YYYY-MM-DD). Slugs are permanent once published.

export type BlogPost = {
  slug: string
  date: string
  title: string
  description: string
  tags: string[]
  body: string
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "the-decision-is-the-unit",
    date: "2026-08-22",
    title: "The rail is changing. The decision is the unit.",
    description:
      "Agent payments are converging on stablecoins — x402 as a Linux Foundation standard, Google's AP2, irreversible settlement. On a rail with no chargeback, the pre-transaction decision is the only control point. What shipped this month, and what comes next.",
    tags: ["x402", "stablecoins", "engine", "roadmap"],
    body: `Agents are starting to pay for things. The rail they are converging on is not the card network — it is stablecoins, settled machine to machine. x402 turned HTTP 402 from a reserved status code into a payment handshake: the server quotes a price, the agent pays, the request proceeds. It is now a Linux Foundation standard with Visa, Mastercard, and Ripple behind it; Stripe ships support; USDC is the dominant asset on the rail. Google's AP2 answers the adjacent question — how an agent proves it was authorized to pay at all — through signed mandates. This is no longer an experiment at the edge. It is the payments industry deciding how machines will buy from machines.

Here is the consequence nobody should shrug at: stablecoin settlement is irreversible. No chargeback, no dispute window, no issuer to call. On card rails, authorization is one control point among several — you can decline, but you can also dispute, reverse, claw back. On this rail, everything after the transfer is final. The pre-transaction decision is the only control point there is. That is exactly the seat Sanction has always occupied.

## What shipped this month

Three concrete pieces, all live.

**The MCP broker.** Register an upstream MCP server on the wallet and point the host at the brokered URL instead: every \`tools/call\` is authorized through the engine — inheritance, conditional rules, observe mode, evidence, escalation — *before* a single byte reaches the fronted server. On brokered traffic, a hijacked agent cannot act. That is the difference between governance that asks the host to cooperate and governance that stands in the path.

**The settlement-aware ledger.** \`POST /v1/authorize\` now accepts optional settlement metadata — \`settlement: {rail: "x402", asset: "usdc", network: "base"}\`, a closed vocabulary. It is inert to the decision itself; the engine rules on the spend, not the rail. But it is recorded on the row, surfaced in evidence, and lands in the audit CSV — so when finance asks what the fleet settled over x402 last month, the ledger already knows.

**The decision meter.** Every fresh engine verdict is now counted, per wallet, per month — approvals, denials, and escalations alike, because a denial is as much work and as much value as an approval. Idempotent replays never count. No fee attaches to it. It exists so the unit is measured honestly long before anything is priced in it.

## The regulatory ground

The GENIUS Act made payment stablecoins a regulated instrument — issuers licensed, reserves examined. The pending CLARITY Act would codify the other half: that non-custodial, non-controlling software is not a money transmitter. Sanction's answer to both is architectural rather than legal: it is non-custodial and veto-only. It can refuse a transfer; it can never initiate one. It holds no keys that move money and no balance that belongs to anyone. Wallets custody. Sanction sanctions — the verb, in its older meaning: to officially authorize.

## What comes next

Honestly: next, not shipped.

- **The x402 spend gate** — the authorization call placed *before* the wallet signs, so an over-budget or off-policy payment never becomes a payment intent at all. The ledger learned the rail this month; the gate is the enforcement half.
- **A Pro tier at $20/month, metered in decisions** — the unit the meter has been counting. In pilot, the subscription is payable by the agent itself, over x402, governed by its own wallet. The product should run on the rail it governs.
- **The co-signer path** — for agent wallet providers who want a policy engine in the signing loop: the wallet holds the keys, Sanction holds the veto.

Every rail war so far has been fought over settlement. This one will be decided at authorization, because on this rail authorization is all there is. Sanction authorizes the spend; any rail settles it.`,
  },
]

export function allPosts(): BlogPost[] {
  return [...BLOG_POSTS].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export function getPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug)
}
