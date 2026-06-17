# Secure Nightly Coding Agent

A small, **runnable** reference for [`@sanction/sdk`](../../sdk) — the governed-autonomy
loop for an autonomous coding agent that runs overnight. It is the executable form
of the [`secure-nightly-coding-agent`](../policies/secure-nightly-coding-agent.json)
policy blueprint (roadmap item DIST-3).

The agent writes code, calls model providers, opens PRs, kicks preview deploys,
and reads a staging DB — each step costs money or touches a secret. **Sanction**
decides what it may do, injects credentials only behind a short-lived token, logs
every dollar, and hands you a clean morning review.

## What it demonstrates

1. **Provision** (management plane / `sk_` key) — create a wallet, register the
   agent, and apply the policy blueprint in one call with `applyBlueprint()`.
2. **Governed task loop** (data plane / `pxy_` key) — before each costly step the
   agent calls `authorize()` and **branches on the returned decision**:
   - an **approved** spend → it runs the step,
   - an **escalated** spend ($5–$20) → it parks the task for a human,
   - a **denied** spend (blocked `marketing` category) → it replans.

   A denial is **returned, not thrown** — the agent branches on `decision.status`
   (no try/catch). This is the whole point: the model never decides its own limits.
3. **Token logging** — `logTokens()` records each model call's cost for budget + audit.
4. **Scoped credential injection** — `withCredential()` requests a ~15-min execution
   JWT scoped to `["github"]`, injects the decrypted GitHub token, opens a PR, and
   lets the token expire. Every injection is audit-logged server-side.
5. **Morning review** — `getStats()` prints today/month spend, token cost, and the
   count of escalations waiting for approval.

## Run it (offline mock — default)

By default it runs against an **in-memory mock** of the Sanction control plane
(a fake `fetch` injected into the SDK clients). No network, no live API, fully
deterministic — ideal for CI and as documentation.

```bash
cd examples/nightly-coding-agent
npm install
npm run demo        # or: npm start
```

Expected output (abridged):

```
Sanction · Secure Nightly Coding Agent
mode: OFFLINE/MOCK (deterministic, no network)

=== 1. Provision (management plane) ===
Applied blueprint "secure-nightly-coding-agent": auto-approve ≤ $5.00, escalate $5.00–$20.00, deny > $20.00, daily cap $50.00

=== 2. Overnight task loop (data plane: authorize + logTokens) ===
• task #42 …  → APPROVED  → Logged token usage ($3.50).
• task #43 …  → ESCALATED (ESCALATION_REQUIRED). Parking task; a human must approve.
• task #44 …  → DENIED    (CATEGORY_BLOCKED). The spend is blocked; replanning.

=== 3. Scoped credential injection (exec token → inject) ===
  → injected github credential: ghp_…se (clearance 3)
  → Opened PR: https://github.com/acme/app/pull/451

=== 4. Morning review (getStats) ===
Approved spend today: $3.50   Pending approvals: 1
```

## Run it (live mode)

Set the env vars below and it talks to the real API through the same SDK code —
no source changes. Create the wallet/agent and store credentials out-of-band
first (see [`examples/policies/README.md`](../policies/README.md)); the mgmt and
agent keys are one-time secrets.

```bash
export SANCTION_API_URL="https://proxy-ai-three.vercel.app/api/v1"
export SANCTION_WALLET_ID="wal_..."
export SANCTION_MGMT_KEY="sk_..."      # management plane (applyBlueprint, stats)
export SANCTION_API_KEY="pxy_..."      # agent data plane (authorize, exec, inject)
npm run demo
```

The `github`/`vercel` credentials must already exist in the wallet's vault (via
`POST /credentials/vault`) for the injection step to succeed.

## How the numbers map to the policy engine

All policy amounts are **integer cents**. The blueprint sets
`escalateOverUsd: 500`, `perTransactionMaxUsd: 2000`, `dailySpendBudgetUsd: 5000`,
which produces: **auto-approve ≤ $5, escalate $5–$20, deny > $20, daily cap $50**.
The decision order (`blocked category → per-txn limit → daily cap → escalate →
approve`) mirrors `app/api/v1/authorize/route.ts`, faithfully reproduced in
[`src/mock-sanction.ts`](./src/mock-sanction.ts).

## Files

| File | Purpose |
|------|---------|
| `src/main.ts` | The demo: provision → governed loop → inject → morning review. Heavily commented. |
| `src/mock-sanction.ts` | In-memory fake `fetch` mirroring the enforced endpoints. Deterministic. |
| `tsconfig.json` | Standalone TS config (this dir is excluded from the Next build). |

## Notes

- Runs with [`tsx`](https://github.com/privatenumber/tsx) so it works as-is on
  Node ≥ 18 without a build step. It imports the SDK directly from `../../sdk/src`.
- No secrets are committed. Mock credentials are obvious placeholders.
- Uses the SDK only — it never hand-rolls `fetch` against the API.
