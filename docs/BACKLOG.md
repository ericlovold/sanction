# Idea backlog

Captured via the `/queue` skill (`.claude/skills/queue/SKILL.md`) — thoughts,
ideas, and questions parked mid-arc so they don't derail the work or get
lost. Newest on top. Checked off = answered, promoted, or dropped (noted
which). Drained via `/zoomout`, not on capture.

This file is public, like the repo — entries are phrased accordingly; the
sensitive substance behind an entry, when there is any, lives in the working
conversation, not here.

## Open

- [ ] 2026-07-09 — AUDIT-2: write-time chain anchors (strengthen AUDIT-1 across
      time). AUDIT-1 makes the *exported* evidence tamper-evident — a verifier
      proves no row changed after signing. It does NOT catch a privileged
      DB-level rewrite of a decision *before* the export is taken. The fix is a
      separate, decoupled `AuditAnchor` table + `POST /v1/audit/anchor` that
      seals the current chain head (root hash + count + range + signature +
      timestamp) on demand or on a schedule; a later export is then cross-checked
      against prior anchors, so any retroactive edit shows up as a head that no
      longer matches a sealed anchor. Deliberately its own isolated write — never
      touches the hot decision transaction (the 18 AuthorizationRequest.create
      sites), which is why AUDIT-1 shipped as read-time first. Optional external
      notarization (S3 Object Lock / RFC-3161 TSA) is a further tier. (follow-up,
      from the AUDIT-1 build)
- [ ] 2026-07-09 — AuthZEN/MCP hardening sprint 2 (deferred from the code-review
      sprint; the CONFIRMED-but-deeper findings): (1) batch grant-atomicity —
      move grant redemption out of evaluateAuthZen into the route shell so a
      sibling item's 400 can't burn a consumed grant with no result returned
      (also fixes the "writes in the decision-only lib" altitude violation);
      (2) binding-token single-use — add a jti + a consumed-token store so a
      denial token is truly one-shot (idempotency-key now required as interim);
      (3) AARP timeout-approve mints no grant → GET returns approved with
      nothing redeemable and re-eval re-escalates (dead loop); (4) rate-limit
      the AuthZEN endpoints (lib/rateLimit exists) — the 50-item batch
      amplifies one request into ~150 DB queries; (5) empty-batch
      `evaluations: []` runs one default-tuple eval instead of returning empty.
      (findings, from the AuthZEN code review)
- [ ] 2026-07-09 — AuthZEN/MCP cleanup cluster (non-correctness, flagged not
      fixed): dedup getSigningKey (lib/jwt owns it), isUniqueViolation (7
      copies → lib), and the readSpendState / notification-fanout /
      entity-schema / route-scaffold duplication across the three routes.
      (cleanup, from the AuthZEN code review)

- [ ] 2026-07-08 — Org-level console visibility across the subtree (extends
      the 07-05 console/API parity entry): the root owner's Approvals and
      Audit pages are scoped to the root wallet only (getViewWallet → one
      wallet), so departmental escalations and audit trails are visible only
      to each pool owner; GET /api/v1/wallets/tree has the rollup but no
      console surface. Add subtree scope to approvals/audit (read-only for
      the org owner) + a tree view. (gap, from architecture walkthrough)
- [ ] 2026-07-08 — Install event instrumentation (P1, from distribution
      review): track the funnel per channel — MCP deeplink clicks, config
      copies, OAuth starts, doc CTA clicks, and first governed call by
      channel. Define the funnel event schema first; acquisition capture
      (utm/src → wallet, shipped same day) is the upstream half. Success
      metric across all channels: time-to-first-governed-decision < 10 min.
      (idea, from distribution review)
- [ ] 2026-07-08 — Install center UX (P1, from distribution review): one
      "Choose your channel" page — MCP / Bedrock / Vercel AI SDK / LangChain —
      with estimated setup time and a first-success checklist per channel.
      Additive inside the existing PWA/dashboard shell, then promote to the
      default discovery entrypoint. Follow-up: A/B MCP-first vs
      channel-picker-first onboarding; ICE-score the experiment backlog and
      set per-channel success thresholds. (idea, from distribution review)
- [ ] 2026-07-08 — Consulting/services discoverability: the services page lives
      at /about ("Work with Eric") but its only entry point is a footer link
      labeled "Consulting" — external reviewers concluded the services offer
      didn't exist (one report cites /consulting as a 404, likely from typing
      the label as a URL). If services becomes a real lane: give it a proper
      /consulting route (or redirect), align label and destination, and
      surface it above the footer. (fix, surfaced by external field scan)
- [ ] 2026-07-08 — Positioning review (external feedback; full text in the
      working conversation): the storefront (home, /why, /architecture, docs,
      license) consistently frames Sanction as a runtime authorization plane
      for production/embedded agents — a developer/platform buyer — while the
      internal-usage story (govern your own org's AI spend by team/department,
      budgets and chargeback for yourself, finance as a buyer) is nearly
      absent, even though the primitives (nested wallets, gateway metering,
      budget cascades, roll-up) already support it. Evaluate: add an
      internal-spend-governance lane vs. reposition. (feedback, via Eric)
      · 2026-07-08, same day: Eric confirmed internal spend governance was
      the intended primary use case all along (now recorded in AGENTS.md
      § Business Context) — the entry upgrades from "evaluate the critique"
      to "close the storefront/intent gap"; still open: how (lane vs.
      reframe) and the services-vs-product end-state call.
      · 2026-07-08 evidence check (grep of app/ copy): the homepage already
      leads with the internal message ("Autonomy for your agents. Authority
      for your team.") — the external anchoring is concentrated in a few
      named-scenario artifacts (docs use-case card "Multi-tenant platforms /
      running agents for many customers", the multi-tenant runbook's framing,
      the license buyer list), while no equivalently concrete internal-org
      scenario is named anywhere (0 hits: department, cost center, budget
      owner, finance-as-buyer). Scope is a targeted patch — add the internal
      scenario at the same concreteness, rebalance those artifacts — not a
      reframe. Validate with 2–3 fresh readers before anything bigger.
      · 2026-07-08, later: independent buyer signal (a real prospect,
      details in the working conversation) — the pitch was understood
      immediately and carried forward on the buyer's side. Comprehension is
      not the problem; the remaining work is specificity vocabulary
      (department / cost center / budget owner / finance) in the concrete-
      scenario layer. Fresh-reader validation: half-satisfied by this signal.
- [ ] 2026-07-08 — Weekend sprint: firm up the Sanction product — pick the
      scope by draining this backlog through /zoomout at sprint start.
      (commitment, from Eric)
- [ ] 2026-07-08 — "Sanctuary" track: a mission-driven companion project under
      the Sanction umbrella — Moral Intention Analyst (MIA), an ethics/intent
      analysis agent built with an external collaborator (engaged and keen;
      partnership specifics live in the working conversation). Eric to help
      drive traffic to it as Sanction's mission arm. Needs an arc: scope what
      MIA is, where it lives (this repo? sibling?), and what "Sanctuary"
      means as a product surface. (idea + collaboration, from Eric)

- [ ] 2026-07-05 — Console/API parity: surface the API-only capabilities in the
      operator console — simulate + pack picker on the policy page, a capability
      rule editor (CAP-1 deferred it), an audit/reporting page with CSV export
      and a period picker. Engines + tests already exist; only the UI is
      missing. Highest-leverage adoption fix. (idea, from product audit)
- [ ] 2026-07-05 — Runtime parity: close "governed in API" vs "governed in the
      runtime." Add sanction_authorize_capability to the MCP server; add
      simulate/packs/evidence/reporting methods to the admin SDK; tool/provision/
      capability on the client SDK. (idea, from product audit)
- [ ] 2026-07-05 — Distribution: framework adapter packages, not just guides —
      SanctionMiddleware for LangChain/LangGraph, a LiteLLM callback, a CrewAI
      authorize tool, Vercel AI SDK middleware. Plus a /compatibility page +
      badges ("Sanction-governed MCP", "AuthZEN PDP compatible", "AARP approval
      loop") and MCP-directory listings (official registry, Smithery, Glama,
      mcp.so, PulseMCP, Cursor Directory). Mostly founder BD + small packages.
      (idea, from distribution review)
- [ ] 2026-07-05 — Channel policy packs: extend PACK-1's catalog with packs
      shaped to a channel — coding-agent, MCP-tool, contractor-seat,
      gateway-token-budget, payment-agent. Pure data + one catalog entry each.
      (idea, from distribution review)
- [ ] 2026-07-05 — Hosted remote MCP endpoint: today sanction-mcp is stdio/npx
      only; a hosted remote endpoint with OAuth/API-key onboarding is the
      enterprise on-ramp. Bigger infra scope. (idea, from distribution review)
- [ ] 2026-07-05 — Implementation kit: packaged onboarding artifacts (policy
      workshop worksheet, pilot checklist, go-live runbook). Harvest from the
      first real customer engagement rather than authoring in a vacuum.
      (idea, from external strategy review)
- [ ] 2026-07-05 — Maturity model as sales framing: Visibility → Metering →
      Authorization → Governance → Evidence. Meet a team at its rung, sell
      the next one; the product already spans all five. (idea, from external
      strategy review) · 2026-07-05: the pack catalog now encodes this ladder
      in-product (each pack carries a maturity tag); the sales-framing use
      remains open.
- [ ] 2026-07-05 — Authority map as a product surface: render who can
      authorize what across the wallet tree. Pairs with the queued
      multi-agent visualization idea. (idea, from external strategy review)
- [ ] 2026-07-05 — Distribution track: pursue agent frameworks/gateways as
      the default authorization adapter; compatibility badges. Mostly
      founder BD/content time. (idea, from external strategy review)
- [ ] 2026-07-05 — Rich denial extras: would_become projected total + rule
      rendered as an expression string. Cosmetic delta on UX-3. (idea)

- [ ] 2026-07-04 — Should the repo go private / be locked? (question, from
      Eric, sparked by the market-intel arc) · initial take delivered
      in-session: stay source-available, lock the strategy not the source —
      revisit if the competitive picture changes.

## Closed

- [x] 2026-07-08 — Agent-fleet parity packaging (from a prospect's platform
      concept where Sanction is the embedded cost governor; specifics in the
      working conversation). Enforcement is ~there; the drop-in gaps, ranked:
      (1) integration guide "Sanction for agent fleets" — channel→pool,
      fleet-agent→agent key, envelope→policy mapping, and the outcome-ceiling
      pattern (external learning layer computes cost-per-outcome, throttles
      via the management API: lower caps / pause agent); (2) optional
      metadata/tags on /authorize, stored on the transaction and rolled up in
      reporting/CSV, so spend attributes to channel/play/campaign natively;
      (3) fleet kill-switch — one action pauses all agents in a subtree;
      (4) marketing-fleet policy pack in the PACK-1 catalog (envelope +
      escalation + kill-switch preset); (5) monthly token budgets (today
      token caps are daily-only; spend caps have monthly) — pairs with the
      queued pooled-token-cap entry; (6) roadmap, not now: a native
      cost-per-outcome ratio primitive (Sanction learns outcomes, enforces
      ratio ceilings itself). (feature set, from prospect concept)
      · 2026-07-08, same day: **all six closed.** (1) docs/AGENT-FLEETS.md shipped
      then revised to native primitives; (2) tags on /authorize shipped;
      (3) landed on main independently as wallet freeze (KILL-1, ancestor
      walk); (4) fleet-channel-envelope pack shipped; (5) monthly + pooled
      token caps shipped; (6) landed on main independently as CPO-1
      (outcome ingestion + ceilings). Fleet parity is now fully native.
- [x] 2026-07-08 — Pooled department token cap (from the internal-E2E
      walkthrough): wallet-policy dailyTokenBudgetUsd acts as a per-agent
      default in the gateway (lib/gateway.ts tokenBudgetUsd/isBudgetExhausted
      aggregate per agent), and the subtree cascade only counts /authorize
      dollars — so "Engineering may not exceed $N/day in tokens as a
      department" is visible (pools page) but not enforceable. For the
      confirmed internal-governance use case this is the flagship hard-cap.
      Likely shape: count token costs into WalletBudgetCounter (or a sibling
      counter) and have the gateway check the ancestor chain like /authorize
      does. (gap, from architecture walkthrough)
      · 2026-07-08, same day: **shipped** — subtreeDailyTokenCapUsd on policy,
      enforced pre-call at the gateway via the ancestor walk (402 names the
      horizon + pool); plus per-seat monthly token budgets. 8 unit tests.

- [x] 2026-07-05 — Policy packs: installable starters. **Promoted** → PACK-1,
      pack catalog + 30-day simulation preview + one-call apply.
- [x] 2026-07-05 — The Manifesto. **Shipped** as [/why](../app/why/page.tsx)
      (six claims; surface decision amended by Eric 2026-07-05).
- [x] 2026-07-05 — Simulation mode: replay stored decision contexts against a
      modified policy. **Promoted same day** → SIM-1, `POST /v1/policy/simulate`
      (slice 1, as-recorded replay; cascade re-fold deferred to slice 2).
