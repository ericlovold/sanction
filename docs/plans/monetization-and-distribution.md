# Microtransactions & distribution — research synthesis

> Status: **proposal** (2026-08-22). Synthesis of a five-discipline research
> fan-out (UX, financial, growth, brand, competitive) commissioned alongside
> `stablecoin-rails.md`. Nothing here is built; Eric decides what promotes.
> The named analog: Zapier — every integration a distribution point, every
> task a billable unit.

## The billable unit: the decision

If Sanction ever meters, the unit is **the decision** — one authorize call
resolved (approve, escalate, or deny). Four disciplines converged on it
independently:

- **Domain:** it already exists in the glossary as the engine's output;
  "grant" and "clearance" are taken, and "sanctions" on an invoice reads as
  OFAC — the plural must never be a noun we bill in.
- **Financial:** it prices *judgment rendered*, not money moved. Basis
  points on authorized spend import payment-processor economics without the
  payment-processor cost basis, and volume-linked revenue is what
  regulators pattern-match to money transmission. **Bps rejected.**
- **Competitive:** nobody in agent payments charges per decision; the
  working precedent is fraud screening (per-transaction micro-fees at
  massive scale), which is exactly Sanction's shape — money at stake,
  evidence attached. Authorization-per-seat vendors prove the contrast:
  per-decision fits high-value risk calls, not high-frequency access checks.
- **Brand:** one meter at every altitude makes the model one story — free
  covers your decisions, self-serve meters them, enterprise commits to a
  volume of them. The metered middle is the on-ramp to the agreement, not a
  tier sheet; "it's free or it's an agreement" evolves rather than breaks.

Straw-man shape (numbers are anchors for discussion, not commitments):
free stays free for individuals, no card, plus an org allowance
(~2,500 decisions/mo); self-serve at ~$20/mo including a bundle, then
single-digit dollars per additional thousand, volume-sliding; enterprise
negotiated against compliance/governance budgets, not payments budgets.
Idempotent replays and Sanction-side errors are never billed.

**The dogfood move:** the self-serve tier should be payable by card *or*
x402/USDC — the governance layer for machine payments accepting machine
payments, an agent paying Sanction through Sanction. Facilitator economics
(fractions of a cent per settlement, batchable) make this viable today.

## Trust before invoices (UX findings)

Per-unit fees are legible; surprise aggregates are resented. Before
charging anything:

1. A **fee meter** on the spend page anchored to governed value — "$4.12 in
   fees governing $18,400 of spend" — not a bare count.
2. An **operator-set cap on Sanction's own fees, enforced by Sanction's own
   engine**, with the at-cap behavior chosen by the operator and shown.
   No overage multipliers, no ambush.
3. **Per-decision receipts** in the existing audit feed and hash-chained
   export.
4. A lapsed Sanction bill must never fail-closed on the customer's
   authorization path — degrade to approve+log+nag grace mode. A denial
   caused by *our* invoice is a brand wound.

Related approval-UX findings (ride with STABLE-1): irreversible-rail
approval cards need the rail badge, post-approval budget remainder, and a
typed-amount confirmation above a policy threshold; timeout-approve should
warn or refuse on irreversible rails; weekly approval-rate stats should
suggest raising the auto-approve floor — protect the escalation band's
signal from consent fatigue.

## Distribution: the Zapier loop, translated

Zapier's engine: every integration is a landing page; partners write the
content; long-tail search converts into per-task usage. Sanction's
equivalent page is the **governed pair** — "govern <provider> spend,"
"approval gates for <framework>," one page per gateway provider, adapter,
and brokered upstream, seeded from the existing docs/ guides.

Ranked distribution points (reach × fit × effort, solo-founder lens):

1. **MCP registries** — official registry, then Glama/PulseMCP/Smithery/
   mcp.so. One `server.json`, five listings, everything downstream
   inherits. ~A day.
2. **Programmatic `/govern/<x>` pages** — template once, add by convention.
3. **Slack App Directory** — the OAuth install and approval flow already
   exist; the gap is the security-review checklist. Every Approve/Deny
   card posted in a shared channel is a product demo in front of people
   who didn't install it — the viral surface is already shipped.
4. **x402/AP2 ecosystem listings** — the ecosystem directories list
   wallets, rails, and facilitators; **no policy layer is listed**. Ship
   STABLE-0/1, then claim the empty slot with the canonical "governing
   irreversible agent payments" write-up.
5. **Claude Code plugin + n8n community node** — a weekend each; n8n
   before Zapier (better-fit audience; Zapier's 90-day beta later, mostly
   for the landing page).
6. **AWS Marketplace (AI Agents & Tools)** — highest enterprise value,
   process-heavy; Q4. Cursor/ChatGPT surfaces and GCP: defer.

## Market context (public-safe summary)

Wallet-native spend controls across the field are **caps, not engines** —
no rules ladder, no escalation→grant workflow, no replayable evidence, no
cross-rail policy tree. That is the moat, and it is only real for orgs —
which matches the confirmed primary use case (governing an org's **own**
AI spend; teams as wallets, chargeback, hard enforcement). Wallet
providers are therefore **channels, not rivals**: the STABLE-2 pitch is
"your wallet signs, our PDP decides — veto-only, non-custodial, and we
never compete for the wallet." Identity-verification players are
complementary (they answer *who*; Sanction answers *may*). The durable
differentiation to name and demo is **evidence** — replayable decisions
and hash-chained exports versus caps-and-alerts.

## Explicitly rejected

- **Bps on authorized spend** — economics and optics both wrong (above).
- **"Sanction," "clearance," or "task" as the billable unit** — plural-OFAC
  collision, glossary collision, and genericness respectively.
- **Claiming OFAC screening as product** — real adjacency, wrong owner;
  integrate screening results as a rule input, never sell the screening.
- **Charging before the trust surfaces exist** — meter, cap, receipts
  first; invoice second.

## First slices (if promoted)

- **MONO-0** — **shipped 2026-08-22**: per-wallet, per-UTC-month
  `WalletDecisionCounter`, incremented once per fresh engine decision across
  all four authorize shells (replays/redemptions/simulate never count;
  increments after the response, failures swallowed). Surfaces as
  `month.decisions` on `/v1/wallets/stats` and a Decisions (month) card on
  the spend console. No fee attaches — the unit is measured before it is
  ever priced.
- **DIST-0** — registry listings + Slack App Directory submission +
  `/govern/<x>` page template.
- **x402-payable tier** — rides STABLE-1; it is monetization and
  go-to-market in one artifact.
- **Counsel memo before any launch** — two questions: does a
  decision-linked fee alter money-transmission analysis, and does
  accepting USDC via x402 for our own invoices create MSB surface.
  One memo; do not self-clear.
