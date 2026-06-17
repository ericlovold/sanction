# @sanction/sdk

TypeScript SDK for [Sanction](../) — the trust layer for autonomous agents.
Gate spend, inject scoped credentials, and manage policy from your agent code.

Zero runtime dependencies (uses the global `fetch`, Node ≥ 18). Ships ESM typed
for bundlers (`moduleResolution: bundler`); consumers bundle it (Next/Vercel/esbuild).

## Two clients

| Client | Key | Use from |
|--------|-----|----------|
| `SanctionClient` | agent key `pxy_…` | **inside the agent** — authorize, logTokens, exec tokens, credential injection |
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
  // a human must approve before proceeding
} else {
  // approved — proceed
}
// (prefer exceptions? authorize(input, { throwOnDeny: true }))

// Record what an LLM call cost (budget + audit):
await sanction.logTokens({ model: "claude-opus-4-8", tokensIn: 1200, tokensOut: 800, costUsd: 0.06, task: "backlog #42" })
```

## Scoped credential access (15-min execution JWT)

```ts
// Request a short-lived token, inject one credential, use it — in one call:
const repoUrl = await sanction.withCredential(
  { scope: ["github"], budgetUsd: 0, label: "github" },
  async (token) => {
    // `token` is the decrypted GitHub credential, valid for ~15 min
    return fetch("https://api.github.com/...", { headers: { authorization: `Bearer ${token}` } })
  },
)

// Or do it in two steps:
const exec = await sanction.requestExecutionToken({ scope: ["github", "vercel"], budgetUsd: 5 })
const cred = await sanction.injectCredential(exec.jwt, "github")
```

## Management plane — provision + apply a policy blueprint

```ts
import { SanctionAdminClient } from "@sanction/sdk"
import blueprint from "../examples/policies/secure-nightly-coding-agent.json"

// 1. Create a wallet (one-time management key — store it)
const wallet = await SanctionAdminClient.createWallet({ name: "nightly-coding", ownerEmail: "you@example.com" })

const admin = new SanctionAdminClient(wallet.managementKey)

// 2. Register the agent (one-time pxy_ key — give it to the agent)
const agent = await admin.registerAgent({ walletId: wallet.id, name: "nightly-coder" })

// 3. Apply a policy blueprint in one call (sends only its `policy` block)
await admin.applyBlueprint(wallet.id, blueprint)

// read / partial-update later:
await admin.getPolicy(wallet.id)
await admin.updatePolicy(wallet.id, { dailySpendBudgetUsd: 7500 }) // cents; omitted fields unchanged
```

## Errors

- `SanctionError` — any non-2xx that isn't a normal decision (`status`, `code`, `body`).
- `AuthorizationDeniedError` — only when you opt into `authorize(..., { throwOnDeny: true })`.

## Config

```ts
new SanctionClient(key, { baseUrl, fetch }) // baseUrl defaults to the production API; inject fetch for tests
```

## Develop

```bash
npm run typecheck   # tsc against sdk/tsconfig.json
npm run build       # emit dist/
# tests run from the repo root: `npx vitest run` (sdk/src/*.test.ts)
```

All amounts in policy objects are **integer cents**, matching the API. See
[`examples/policies/`](../examples/policies/) for ready-to-apply blueprints.
