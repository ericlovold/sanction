# @sanction/sdk

TypeScript SDK for [Sanction](https://getsanction.com) — the independent
authorization plane for AI agents. Gate spend, authorize tools *before* they
run, inject scoped credentials, and manage policy from agent or owner code.

```bash
npm install @sanction/sdk
```

Zero runtime dependencies (uses the global `fetch`, Node ≥ 18). Ships ESM +
types. License: **FSL-1.1-MIT** (same as the Sanction server source — see
[Commercial License](https://getsanction.com/docs/commercial-license)).

## Two clients

| Client | Key | Use from |
|--------|-----|----------|
| `SanctionClient` | agent key `pxy_…` | **inside the agent** — authorize, logTokens, exec tokens, credential injection, tool gate |
| `SanctionAdminClient` | management key `sk_…` | **owner/control side** — create wallets, register agents, manage policy. Never ship this key in an agent. |

## Data plane — gate an action before it happens

```ts
import { SanctionClient } from "@sanction/sdk"

const sanction = new SanctionClient(process.env.SANCTION_API_KEY!) // pxy_...

const decision = await sanction.authorize({
  action: "purchase",
  amountUsd: 3.5,
  merchant: "anthropic",
  category: "software",
  description: "claude tokens for backlog task #42",
  idempotencyKey: "job-42-step-3", // safe to retry
})

// A `denied` decision is RETURNED, not thrown — branch on it and replan:
if (decision.status === "denied") {
  console.warn(`blocked: ${decision.code} — ${decision.remediation}`)
} else if (decision.status === "escalated") {
  // Poll until the owner approves, then retry with the grant:
  const status = await sanction.getAuthorization(decision.requestId)
  if (status.grantId) {
    // retry authorize / authorizeTool with grantId: status.grantId
  }
} else {
  // approved — proceed
}
```

## Tool gate — the tool runs behind the decision

```ts
import { SanctionClient, SanctionMiddleware, sanctionTool, SanctionToolBlocked } from "@sanction/sdk"

const client = new SanctionClient(process.env.SANCTION_API_KEY!)
const runTool = SanctionMiddleware(client)

try {
  await runTool({
    server: "github",
    tool: "create_pr",
    input: { title, body },
    run: () => octokit.pulls.create({ ... }), // runs ONLY if approved
  })
} catch (e) {
  if (e instanceof SanctionToolBlocked) {
    // e.status: "escalated" → poll e.requestId via getAuthorization, then retry with grantId
    // e.status: "denied" → replan
  }
}

// Vercel AI SDK: wrap tool() so execute is gated
import { tool } from "ai"
const deploy = sanctionTool(client, "deploy", tool({ /* ... */ }), { server: "ci" })
```

`authorizeTool` fails **closed** — if Sanction is unreachable it returns
`denied`, so an ungoverned tool never runs.

## Scoped credential access (15-min execution JWT)

```ts
const result = await sanction.withCredential(
  { scope: ["github"], budgetUsd: 0, label: "github" },
  async (token) => {
    return fetch("https://api.github.com/...", { headers: { authorization: `Bearer ${token}` } })
  },
)
```

## Management plane — provision + set policy

```ts
import { SanctionAdminClient } from "@sanction/sdk"

const wallet = await SanctionAdminClient.createWallet({ name: "nightly-coding", ownerEmail: "you@example.com" })
const admin = new SanctionAdminClient(wallet.managementKey)
const agent = await admin.registerAgent({ walletId: wallet.id, name: "nightly-coder" })
await admin.updatePolicy(wallet.id, {
  dailySpendBudgetUsd: 75,
  autoApproveUnderUsd: 5,
  escalateOverUsd: 25,
  perTransactionMaxUsd: 100,
  blockedCategories: ["crypto"],
})
```

## Errors

- `SanctionError` — any non-2xx that isn't a normal decision (`status`, `code`, `body`).
- `AuthorizationDeniedError` — only when you opt into `authorize(..., { throwOnDeny: true })`.
- `SanctionToolBlocked` — thrown by middleware / `sanctionTool` on non-approved tool decisions.

## Config

```ts
new SanctionClient(key, { baseUrl, fetch }) // baseUrl defaults to https://getsanction.com/api/v1
```

## Develop (from the monorepo)

```bash
cd sdk && npm run typecheck && npm run build
# from repo root:
npx vitest run sdk/src
```

All monetary policy fields are in **dollars**. The SDK speaks camelCase; the
wire is snake_case, mapped internally.
