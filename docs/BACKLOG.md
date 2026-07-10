# Idea backlog

Captured via the `/queue` skill (`.claude/skills/queue/SKILL.md`) — thoughts,
ideas, and questions parked mid-arc so they don't derail the work or get
lost. Newest on top. Checked off = answered, promoted, or dropped (noted
which). Drained via `/zoomout`, not on capture.

This file is public, like the repo — entries are phrased accordingly; the
sensitive substance behind an entry, when there is any, lives in the working
conversation, not here.

## Open

- [ ] 2026-07-10 — Opaque dashboard sessions (~half a day; scoped in the
      2026-07-10 audit consolidation, report in the working conversation):
      make dashboard session handling legible/auditable rather than opaque.
      (finding, from the repo audit)
- [ ] 2026-07-10 — RLS on the decision spine (~2–3 days; scoped in the
      2026-07-10 audit consolidation): extend Postgres Row-Level Security
      beyond the credential vault to the authorization/decision tables, so
      tenant isolation on the spine is enforced by the database, not only by
      query discipline. Cheap early slice: denormalize `walletId` (+
      `decisionCode`) onto AuthorizationRequest — gives RLS a native tenant
      key and removes the agent-join from every tenant-scoped read.
      (finding, from the repo audit)
- [ ] 2026-07-09 — Sequential simulation follow-ons (SIM-2 shipped: mode=sequential
      threads per-agent daily/monthly approved spend forward). Next: (1) thread
      SUBTREE/pool caps too — the sequential note flags they're held constant, so
      a pooled cap can't yet free budget across siblings in replay; (2) a dashboard
      toggle on the policy simulation preview (as-recorded vs sequential) so
      operators see the cascade without curling; (3) provision-ladder overlay in
      simulation (still out_of_scope). (feature, from roadmap Next)
- [ ] 2026-07-09 — Framework adapters, follow-on packages (roadmap Next; the
      TS foundation shipped: SDK authorizeTool + SanctionMiddleware +
      sanctionTool for Vercel AI SDK). Remaining, each its own shippable unit:
      (1) Python package — LiteLLM callback + a sanctioned-tool decorator for
      LangChain/LangGraph (recipes already in docs/FRAMEWORK-ADAPTERS.md);
      (2) CrewAI authorize-tool; (3) a runnable examples/ agent per adapter;
      (4) once gateway vault-injected keys land, drop the "provider keys in
      runtime" caveat from the adapter checklist. (feature, from roadmap Next)

- [x] 2026-07-09 — AuthZEN/MCP hardening sprint 2 (deferred from the code-review
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
      · 2026-07-09, same day: **shipped** (AUTHZEN-HARDEN in TRACEABILITY).
      (1) landed as pre-validation (`validateAuthZenSemantics` over every
      batch item before any evaluation) — kills the grant burn without
      touching the redemption plumbing; the shell-refactor altitude cleanup
      stays in the cleanup-cluster entry below. (2)–(5) landed as specified
      (jti + ConsumedBindingToken table, policy_timeout grants, per-agent
      429s, empty-batch empty).
- [ ] 2026-07-09 — AuthZEN/MCP cleanup cluster (non-correctness, flagged not
      fixed): dedup getSigningKey (lib/jwt owns it), isUniqueViolation (7
      copies → lib), and the readSpendState / notification-fanout /
      entity-schema / route-scaffold duplication across the three routes.
      (cleanup, from the AuthZEN code review)

- [x] 2026-07-08 — Org-level console visibility across the subtree (extends
      the 07-05 console/API parity entry): the root owner's Approvals and
      Audit pages are scoped to the root wallet only (getViewWallet → one
      wallet), so departmental escalations and audit trails are visible only
      to each pool owner; GET /api/v1/wallets/tree has the rollup but no
      console surface. Add subtree scope to approvals/audit (read-only for
      the org owner) + a tree view. (gap, from architecture walkthrough)
      · 2026-07-10: **shipped** — Audit page aggregates the whole subtree
      (KPIs, by-agent, feed) with a Pool column when it spans pools;
      Approvals gains a read-only "Waiting in your pools" section (each
      pool's owner still decides); shared bounded-CTE subtree helper
      (lib/walletSubtree) also backs the pools page. Tree view was already
      live on /dashboard/pools. Verified by rendering against a seeded
      two-level org.
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
      · 2026-07-10: /consulting → /about redirect shipped (temporary, so a
      real page can claim the path later) — the 404 is dead. "Surface above
      the footer" deliberately NOT done: that's the services-vs-product
      end-state call, still open below.
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
      · 2026-07-10: the vocabulary patch shipped — a first-position
      "Internal AI governance" scenario card on /docs (departments as
      wallets, cost centers, chargeback for finance, freeze), the
      multi-tenant runbook's opening reframed ("a tenant can be a department
      or cost center"), and the license table's FSL "Who" row now names
      internal fleets explicitly. Remaining: the lane-vs-reframe end-state
      call and 2–3 fresh-reader reads of the patched surfaces.
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

- [ ] 2026-07-08 — Hardening sprint from external code review (Codex) of the
      seat-leadership build: P0 — bound the recursive wallet-subtree CTE on
      the seats page (depth/node cap + truncation notice, mirroring Pools),
      fix the approvals "expiring in 15m" count to exclude already-expired,
      return `{ok, message}` from credential/token server actions instead of
      silent void; P1 — action-level tests for batch seat creation,
      credential CRUD, token revoke, plus one smoke path across
      seats→rotate→credential→token; P2 — Bedrock Action Group setup guide,
      runnable Vercel AI SDK + LangChain minimal examples, channel
      attribution (utm→wallet) and a "first governed call" KPI. Full
      checklist with files/test cases lives in the working conversation.
      (feedback, needs an arc)
- [x] 2026-07-05 — Console/API parity: surface the API-only capabilities in the
      operator console — simulate + pack picker on the policy page, a capability
      rule editor (CAP-1 deferred it), an audit/reporting page with CSV export
      and a period picker. **Shipped** → console-parity PR1–PR3 (#116, #117,
      #119): full policy editor, pack picker + simulation preview, audit &
      reporting page with CSV export. Capability rule editor remains deferred
      with CAP-1. (closed 2026-07-08)
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
      (idea, from distribution review) · 2026-07-08: promoted — ship exactly
      ONE adapter first (LiteLLM callback or LangChain middleware), not the
      full list; the rest follow demand.
- [x] 2026-07-05 — Channel policy packs: extend PACK-1's catalog with packs
      shaped to a channel — coding-agent, MCP-tool, contractor-seat,
      gateway-token-budget, payment-agent. Pure data + one catalog entry each.
      (idea, from distribution review)
      · 2026-07-10: **shipped** across channels (coding-agent-seat, mcp-tool-
      governance, gateway-token-budget, agency-*, payment-agent-mandate) plus
      **no-egress** for Sanction Local (`channel: local`). LOCAL-1.
- [ ] 2026-07-05 — Hosted remote MCP endpoint: today sanction-mcp is stdio/npx
      only; a hosted remote endpoint with OAuth/API-key onboarding is the
      enterprise on-ramp. Bigger infra scope. (idea, from distribution review)
      · 2026-07-08: promoted — this is also the Sanction-owned enforcement
      point (governed traffic must pass through it, not "we hope the agent
      called authorize"). Decision logic stays in the engine, not the proxy.
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
