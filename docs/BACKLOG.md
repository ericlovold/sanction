# Idea backlog

Captured via the `/queue` skill (`.claude/skills/queue/SKILL.md`) — thoughts,
ideas, and questions parked mid-arc so they don't derail the work or get
lost. Newest on top. Checked off = answered, promoted, or dropped (noted
which). Drained via `/zoomout`, not on capture.

This file is public, like the repo — entries are phrased accordingly; the
sensitive substance behind an entry, when there is any, lives in the working
conversation, not here.

## Open

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

- [x] 2026-07-05 — Policy packs: installable starters. **Promoted** → PACK-1,
      pack catalog + 30-day simulation preview + one-call apply.
- [x] 2026-07-05 — The Manifesto. **Shipped** as [/why](../app/why/page.tsx)
      (six claims; surface decision amended by Eric 2026-07-05).
- [x] 2026-07-05 — Simulation mode: replay stored decision contexts against a
      modified policy. **Promoted same day** → SIM-1, `POST /v1/policy/simulate`
      (slice 1, as-recorded replay; cascade re-fold deferred to slice 2).
