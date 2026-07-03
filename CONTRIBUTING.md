# Contributing to Sanction

Welcome. This page gets you from clone to confident PR. It assumes you're a
person; AI sessions get their briefing from `AGENTS.md`.

## What this is

Sanction is the authorization layer for AI agents: before an agent spends
money, invokes a tool, touches a credential, or provisions a resource, it asks
Sanction. Approve / escalate to a human / deny, every decision logged. Start
with `README.md` for the product, `docs/DOMAIN.md` for the vocabulary
(wallet, agent/seat, policy, grant, clearance), and `docs/TRACEABILITY.md`
for the map of every security claim to the code that enforces it and the test
that proves it.

## Setup

```bash
npm install          # postinstall generates the Prisma client automatically
npm run check        # typecheck + lint + 500+ unit tests — no database needed
npm run dev          # Next.js dev server
```

Unit tests run with a mocked database, so `npm run check` works the moment
install finishes. The DB-backed suites (`npm run test:db`) need a real
Postgres in `DATABASE_URL` plus `RUN_DB_TESTS=1` and the two crypto env vars —
see `.env.example`. CI runs both suites either way, so you can lean on it.

## The gates (every push, every PR)

- `npm run check` must pass: `tsc`, ESLint, unit tests.
- **Coverage floor: 80% statements/lines, 80% branches, 85% functions.** It's
  a ratchet — it moves up as coverage grows, never down. New code needs tests.
- DB tests run in CI against a real Postgres service.
- CodeRabbit reviews every PR; a human merges.

If your change touches anything listed in `docs/TRACEABILITY.md`, keep its
row true — update the row, the tests, or both, in the same PR.

## Layout in one minute

| Where | What |
|---|---|
| `app/api/v1/*` | The REST API (authorize, agents/seats, vault, approvals, audit) |
| `app/api/gateway/*` | The LLM gateway proxy (metering + budget wall) |
| `app/dashboard/*` | Operator console |
| `app/*` (rest) | Marketing site + public pages |
| `lib/` | All logic: the decision engine (`evaluation.ts`, `rules/`), budgets, grants, crypto |
| `docs/` | Public guides (rendered at `/docs/[slug]` via `lib/docs.ts`) + internal records |
| `tests/` | Unit suites (mocked DB) and `*.db.test.ts` (real Postgres) |
| `mcp-server.ts` → `packages/sanction-mcp` | The published MCP server |
| `sdk/` | `@sanction/sdk` TypeScript client |

## Working style

- **Small, fenced PRs.** Change what the task needs; flag adjacent problems
  instead of fixing them in the same diff.
- **Branch → PR → green CI → merge.** No direct pushes to `main`.
- **Money is stored in cents; the API and UI speak dollars.** `lib/policy.ts`
  is the single conversion point. This is the #1 new-contributor trap.
- **Keys are shown once, stored only as hashes.** Never log or persist a raw
  key, and never commit real wallet ids or API keys.
- **Content and docs are product surface here.** The changelog, roadmap, and
  docs pages ship through the same PR flow as code — copy PRs are first-class.
- `.claude/skills/` holds the working-style skills AI sessions follow (plan
  before edits, verify against live state, fence your scope). They're worth a
  read — they describe how this repo likes work to happen, human or not.

## Good first territory

- **Docs & content**: the guides in `docs/` (rendered on-site), the changelog
  voice, README accuracy against the live product.
- **Dashboard**: the operator console has the repo's only known test gap
  (see TRACEABILITY's Gaps section) and always has UX headroom.
- **Examples**: `examples/` — runnable references for agent builders.

Questions: open an issue, or say so in Slack.
