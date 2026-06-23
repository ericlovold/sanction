# Show HN draft — Sanction

## Title options (pick one)
1. `Show HN: Sanction – financial control for autonomous AI agents`
2. `Show HN: Sanction – don't give your AI agent your credit card`
3. `Show HN: Sanction – spend limits, approvals, and budgets for AI agents`

(1) is the safest/clearest; (2) is the most clickable but riskier on HN. I'd run (1).

---

## Post body

I've been building autonomous agents that call paid APIs, spin up infra, and burn
tokens overnight. Handing one an API key and a credit card is terrifying: no spending
limit, no approval step, no audit trail. Observability tools (Langfuse, Helicone) tell
you what an agent spent *after* the fact — I wanted something that could *stop* it before.

Sanction is a control layer between an agent and spend. Before an agent buys something,
tops up credits, or uses a secret, it calls Sanction, which **approves / escalates to a
human / denies** based on a policy you set. Token usage is metered against per-agent and
per-wallet budgets. Credentials live in a vault and are handed out via short-lived
(15-min) scoped tokens — so the same key that governs spend also governs access.

It's an MCP server and a REST API, so it drops into Claude / Gemini / LangChain agents in
a few lines:

    npx sanction-mcp

- Live dashboard (real data): https://getsanction.com/dashboard/spend
- 2-min quickstart + a runnable Gemini agent example: https://github.com/ericlovold/sanction/tree/main/examples
- Create a wallet: `POST https://getsanction.com/api/v1/wallets`

How it works: you create a wallet with a policy (per-transaction max, daily spend budget,
daily token budget, escalate-over threshold, blocked categories). Each agent gets its own
key and can carry its own budget overrides. `/authorize` runs the decision engine; daily
budget checks happen inside a per-agent advisory lock so concurrent calls can't overshoot,
and idempotency keys make retries safe. Anything over the escalation threshold pauses in an
approval queue until a human approves or rejects; the agent polls for the result.

It's early, and I want to be honest about that. The strongest use today is **cost
governance** — per-agent/model/task budgets that actually halt the agent — plus spend
approval. Where I think this goes: as agents start paying for APIs, vendors, and services
directly, every agent needs a wallet with policy and an approval loop. Sanction aims to be
that layer, and it stays rail-agnostic (it gates the action; it isn't the payment rail).

I'd love feedback on two things:
1. Is "per-agent budget + approval queue" the right primitive, or is there a better control surface?
2. What would you need before you'd put this in front of a real agent spending real money?

---

## First comment (post immediately, technical depth)

Stack: Next.js + Prisma/Postgres on Vercel; the MCP server is a zero-dep stdio bundle
(`npx sanction-mcp`). A few design notes for the curious:

- **Atomic budgets:** the daily-spend and token-budget checks run inside a Postgres
  `pg_advisory_xact_lock` keyed on the agent, then re-read inside the transaction — so two
  concurrent authorize calls can't both pass the check and blow the cap.
- **Two planes:** a management key (`sk_`, shown once) gates policy/agents/approvals; an
  agent key (`pxy_`) only does data-plane calls (authorize, log tokens). Wallets with no
  management key fail closed.
- **Decisions are machine-readable:** denials return a stable `code` + remediation hint so
  an agent can replan instead of hallucinating on a bare 403.
- **Credentials:** AES-256-GCM at rest, injected only via a scoped JWT with a 15-min TTL;
  every injection is audit-logged, raw values never are.

When a charge escalates, the owner gets a signed webhook (wire it to Slack/PagerDuty);
the agent polls for the outcome. Known gaps: no SSO yet, single-region. Happy to go
deeper on any of it.
