# Stablecoin rails — design position

> Status: **STABLE-0 and STABLE-1 shipped** (2026-08-22). STABLE-0:
> `/v1/authorize` accepts optional `settlement` `{rail, asset, network}` —
> closed vocabulary, inert to the decision, persisted and surfaced in the
> audit feed/CSV and OpenAPI. STABLE-1: the spend gate — `POST
> /v1/authorize/quote` prices an x402 challenge and runs it through the same
> ladder before the wallet signs, and the MCP broker *intercepts* upstream
> 402s, withholding the challenge on refusal. Two corrections this slice
> made to the proposal, kept as the record: (1) pricing is deliberately
> narrow — USD-pegged stablecoins with known decimals only, because a
> decision that depends on an FX lookup at decision time breaks determinism;
> (2) a challenge offering several ways to pay is authorized at its WORST
> case, and one unpriceable option poisons the whole challenge, since the
> client picks and we cannot know which. STABLE-2 (wallet-provider co-signer,
> veto-only) is next.
>
> Original framing (2026-08-22, from Eric's direction: agents will spend,
> authorized spend will not settle in card-rail USD — it settles in regulated
> stablecoins, most likely USDC. Build the path.)
>
> Companion: `monetization-and-distribution.md` (same date) — the
> five-discipline research synthesis on microtransaction monetization (the
> decision as the billable unit) and distribution points (the Zapier loop).

## The thesis, stated precisely

Sanction answers one question: *may this agent spend this amount on this
thing right now?* Stablecoins do not change that question — they change what
happens after "yes." And they raise the stakes of "yes": stablecoin
settlement is **irreversible**. No chargeback, no dispute window, no
issuer to claw it back. On card rails, authorization is one of several
control points; on stablecoin rails, **pre-transaction authorization is the
only control point**. That is Sanction's exact seat at the table. The rail
shift makes the engine more necessary, not less.

## What is true in the market (verified 2026-08-22, primary/secondary sources)

- **x402** (Coinbase, May 2025) activates HTTP 402 as a machine payment
  protocol: server replies 402 + price, client signs a stablecoin transfer
  (dominantly USDC), resends with payment attached. Now a **Linux
  Foundation** standard (x402 Foundation) backed by Visa, Mastercard, and
  Ripple; Stripe shipped support (Machine Payments, Feb 2026, USDC on
  Base); Cloudflare and AWS reference it; ~75M transactions/30d as of
  mid-2026, mostly sub-dollar.
- **AP2** (Google's Agent Payments Protocol, Sept 2025; v0.2.0 Apr 2026)
  authorizes agent commerce through **signed Intent / Cart / Payment
  Mandates**, with a co-developed A2A x402 extension so AP2-authorized
  agents settle via x402. Partner-integration stage; 60+ partners.
- **GENIUS Act** (US, July 2025) made payment stablecoins a regulated
  instrument — the "crypto-regulated stablecoin" Eric names exists in law.
- **CLARITY Act** (H.R. 3633 — verified 2026-08-22): the market-structure
  bill, bigger in scope than GENIUS — it settles SEC/CFTC jurisdiction over
  digital assets. House passed 294–134 (July 2025); Senate Banking advanced
  it 15–9 (May 2026); Senate cloture vote scheduled **2026-09-15**. Not law
  yet. The provision that matters most to Sanction is **Section 604**
  (incorporating the Blockchain Regulatory Certainty Act): **non-custodial,
  non-controlling software developers are not money transmitters** and
  carry no BSA obligations. The test is "non-controlling": no legal right
  to control user transactions, no unilateral ability to initiate them, no
  ability to effectuate transfers without another party's approval.

  **Design constraint this imposes (adopt now):** Sanction must remain
  **veto-only**. A co-signer that can only *refuse* a transfer the wallet
  initiates sits inside the Section 604 safe harbor; a signer that can
  *initiate or effectuate* transfers steps outside it. STABLE-2 and
  STABLE-3 are therefore specified as veto-only co-signing — Sanction can
  say no, and can never say go on its own. This was already our
  architecture (identity and funds stay upstream); CLARITY makes it the
  legal architecture too. Re-verify status after the Senate vote.

## What is already in hand (verified against this repo)

1. **The gateway already speaks 402** — over-budget returns HTTP 402. x402
   made that same status code the payment handshake. We are already in the
   right conversation, on the right verb.
2. **Mandates are our word too.** WALLET-1 shipped `POST /v1/mandate/verify`
   and the Wallet Card carry/present/verify path. AP2's mandate chain is the
   same concept from the payments side. Convergent vocabulary = adapter, not
   rebuild.
3. **BROKER-1 intercepts traffic.** An x402 handshake by a brokered agent is
   interceptable traffic — the enforcement point exists.
4. **Policy is stored in cents.** USDC is cent-denominated USD. The ledger,
   budgets, and cascade counters need **no FX model** for the primary case.

## The path (slices, in order)

- **STABLE-0 — rail-agnostic ledger (small, do soon).** Authorization
  requests accept optional settlement metadata (`rail`, `asset`, `network`),
  validated as a closed vocabulary, recorded in decision evidence and the
  ledger. Zero enforcement change; the audit trail becomes crypto-aware and
  the positioning sentence becomes true: *Sanction authorizes the spend;
  any rail settles it.*
- **STABLE-1 — the x402 spend gate.** When an agent's call through the
  gateway or broker meets a 402 + x402 payment requirement, Sanction treats
  the quoted amount as a spend authorization: `/authorize` runs **before**
  the agent's wallet signs. Deny ⇒ the transfer is never signed. This is
  "a hijacked agent cannot spend" carried onto the stablecoin rail, and it
  is non-custodial — Sanction gates the signing decision, never the keys.
- **STABLE-2 — policy co-signer for agent wallets.** Agent wallet providers
  (Coinbase CDP, MetaMask, Crossmint et al.) call Sanction before signing —
  the AuthZEN PDP endpoint already exists for exactly this shape. Map
  decisions onto AP2 mandate verification so a Sanction-approved spend can
  carry/verify as an AP2 Payment Mandate constraint.
- **STABLE-3 — onchain mirror (research only).** ERC-4337 session-key /
  smart-account policy modules mirroring Sanction policy, so even a stolen
  key cannot exceed limits without a Sanction co-sign. Do not build until
  STABLE-1/2 prove demand.

## Explicitly rejected

- **Custody.** Holding user funds or signing keys drags money-transmitter /
  GENIUS-adjacent regulatory surface onto a solo-founder product and breaks
  the first engineering principle (identity stays upstream — and so do
  funds). Sanction is the decision layer; wallets custody, Sanction
  sanctions.
- **A speculative token / chain of our own.** Not the business.
- **Building against unstable specs.** AP2 is v0.2.x with no documented
  live consumer deployments; integrate at the mandate-vocabulary level
  (STABLE-0/1 are AP2-independent), commit to AP2 wire formats only when
  they stabilize.

## Engineering-principles check

Identity upstream: keys and funds stay with the wallet provider — pass.
Atomic authorization: a stablecoin spend resolves through the same engine,
same budgets, same grants, same ledger — pass. Determinism: settlement
metadata enters the decision context once, at the shell; evidence replay
never touches a chain — pass.
