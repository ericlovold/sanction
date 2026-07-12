# Pay-per-crawl — govern what your agents pay the web

> As of July 2026, Cloudflare's pay-per-crawl and Monetization Gateway let any
> site, dataset, API, or MCP tool behind Cloudflare charge agents per request,
> settling over the x402 protocol — and agent/training crawlers are blocked by
> default on ad-supported pages from September 15. The open web is becoming a
> metered resource. This guide is the buyer's side: when your fleet meets a
> `402 Payment Required`, **who decides what gets paid?**

## The problem with a static cap

The protocol's built-in answer is a `crawler-max-price` header: "pay any site
up to X." That's a cap, not governance. It can't distinguish a $0.01 quote
from a domain you've paid 40,000 times today, can't escalate an unusual price
to a human, can't give finance a per-department view of content spend, and
leaves no decision trail when someone asks why the bill happened.

A pay-per-crawl quote is just a spend authorization with the site as the
merchant — so Sanction's whole engine applies unchanged: auto-approve bands,
per-transaction hard caps, daily/monthly budgets, pooled department caps,
escalation to a human inbox, cost-per-outcome ceilings, and the audit trail.

## The wire, governed

Pay-per-crawl's flow (see Cloudflare's AI Crawl Control docs):

1. Your crawler requests a paid URL → `402` with a `crawler-price: USD 0.05` quote.
2. To buy, the crawler retries with `crawler-exact-price` (or `crawler-max-price`)
   signed under Web Bot Auth.
3. `200` + `crawler-charged: USD 0.05` → a billing event on your Cloudflare account.

`sanctionedFetch` puts Sanction between steps 1 and 2:

```ts
import { SanctionClient, sanctionedFetch, SanctionCrawlBlocked } from "@sanction/sdk"

const client = new SanctionClient(process.env.SANCTION_API_KEY!)

// Pass YOUR fetch — the one that signs Web Bot Auth headers. Identity stays
// upstream: Sanction decides and sets the price header; your stack signs.
const fetch = sanctionedFetch(client, signingFetch)

try {
  const res = await fetch("https://example.com/research/report")
  // free page   → passed through untouched
  // paid page   → quote authorized; approved → retried with
  //               crawler-exact-price echoing the site's own quote verbatim
} catch (e) {
  if (e instanceof SanctionCrawlBlocked) {
    // e.status: "escalated" (poll e.requestId for the grant) or "denied" (skip)
    // e.priceUsd, e.url, e.code — a planning outcome, not a crash
  }
}
```

Every quote becomes a decision with `merchant` = the site's hostname,
`category` = `content-access` (override per crawler), and attribution tags
(`channel: pay-per-crawl`, the URL) — so the audit feed and CSV export roll
content spend up by site, by crawler, by department.

## Policy recipe

A crawl fleet's starting policy, in dollars:

```jsonc
{
  "auto_approve_under_usd": 0.10,   // routine quotes clear instantly
  "per_transaction_max_usd": 1.00,  // no single page is worth more — hard stop
  "daily_spend_budget_usd": 25,     // per-crawler daily content budget
  "escalate_over_usd": 0.25,        // unusual quotes ask a human first
  "blocked_categories": []          // add "content-access" on a crawler to switch paying off entirely
}
```

Departments running their own crawlers? Make each a pool (wallet) under your
org: pooled daily caps enforce the department line, roll-ups give finance the
chargeback view, and freeze stops a runaway crawler's spending in one call.

## Honest boundary

- Sanction governs the **decision to pay** and sets the payment-intent header.
  The billing relationship (crawler registration, Web Bot Auth keys, settlement)
  is between your organization and Cloudflare — and the payment header must be
  covered by your `signature-input` components, so wrap your *signing* fetch.
- `crawler-charged` on the response is the seller's receipt; Sanction's decision
  record is yours. Cross-checking the two (reconciliation) is on the roadmap as
  part of the mandate-authority (x402) arc.
- Prices are quoted in USD; sub-cent quotes round to $0.00 in cents-based
  budget math and will ride the auto-approve band — the per-URL decision and
  tags are still recorded.
