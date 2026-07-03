/**
 * Secure Nightly Coding Agent — a runnable reference for @sanction/sdk (DIST-3).
 *
 * The story: you let an autonomous coding agent run overnight. It writes code,
 * calls model providers, opens PRs, kicks preview deploys, reads a staging DB.
 * Every one of those costs money or touches a secret. Sanction is the layer that
 * decides what it may do, injects credentials only behind a short-lived token,
 * logs every dollar, and hands you a clean morning review.
 *
 * The governed-autonomy loop demonstrated here:
 *   1. (Admin)  create a wallet, register the agent, APPLY a policy blueprint.
 *   2. (Agent)  before each costly/sensitive step, call authorize() and BRANCH
 *               on the returned decision — approved / escalated / denied.
 *   3. (Agent)  log token usage with logTokens().
 *   4. (Agent)  request an execution token and inject a credential with
 *               withCredential() (scoped, ~15-min TTL, audit-logged).
 *   5. (Owner)  print a morning-review summary from getStats().
 *
 * RUN MODES
 *   - Default OFFLINE/MOCK: a fake in-memory Sanction is injected into the SDK,
 *     so this runs green with no network and no live API. Deterministic.
 *   - LIVE: set SANCTION_API_URL + SANCTION_MGMT_KEY (or the wallet/agent vars
 *     below) and it talks to the real API instead. See README.
 *
 * IMPORTANT: we use the SDK (SanctionClient / SanctionAdminClient). We never
 * hand-roll fetch against the API — the SDK owns the wire format.
 */

import { SanctionClient, SanctionAdminClient } from "../../../sdk/src/index.ts"
import type { ClientOptions, Decision } from "../../../sdk/src/types.ts"
import { createMockSanction } from "./mock-sanction.ts"
// The blueprint is just JSON — applyBlueprint() sends only its `policy` block.
import blueprint from "../../policies/secure-nightly-coding-agent.json" with { type: "json" }

// ---------------------------------------------------------------------------
// Tiny console helpers (no dependency on a logging lib — keep it light).
// ---------------------------------------------------------------------------
const line = (s = "") => console.log(s)
const head = (s: string) => console.log(`\n=== ${s} ===`)
// The SDK speaks dollars (PolicyInput / Decision amounts are dollars), so this
// formatter takes dollars. The API stores cents internally; the wire is dollars.
const usd = (dollars: number) => `$${dollars.toFixed(2)}`

// ---------------------------------------------------------------------------
// Mode selection. Live mode is gated entirely on env vars; otherwise mock.
// ---------------------------------------------------------------------------
const LIVE = Boolean(process.env.SANCTION_API_URL && (process.env.SANCTION_MGMT_KEY || process.env.SANCTION_API_KEY))

async function main() {
  line("Sanction · Secure Nightly Coding Agent")
  line(LIVE ? "mode: LIVE (talking to the real API)" : "mode: OFFLINE/MOCK (deterministic, no network)")

  // In mock mode we inject one shared fake-fetch into every SDK client so they
  // all hit the same in-memory server. In live mode `opts` is empty and the SDK
  // uses global fetch + its default production base URL.
  const mock = LIVE ? null : createMockSanction()
  const baseUrl = process.env.SANCTION_API_URL // undefined => SDK default
  const opts: ClientOptions = { ...(baseUrl ? { baseUrl } : {}), ...(mock ? { fetch: mock.fetch } : {}) }

  // =========================================================================
  // 1. ADMIN / OWNER SIDE — provision the wallet, agent, and policy.
  //    Uses the management key (sk_...). NEVER ships inside the agent.
  // =========================================================================
  head("1. Provision (management plane)")

  let walletId: string
  let managementKey: string
  let agentApiKey: string

  if (LIVE) {
    // In live mode you have already created these out-of-band (the mgmt and
    // agent keys are one-time secrets). Read them from the environment.
    walletId = required("SANCTION_WALLET_ID")
    managementKey = required("SANCTION_MGMT_KEY")
    agentApiKey = required("SANCTION_API_KEY")
    line(`Using existing wallet ${walletId} from environment.`)
  } else {
    // Mock mode: do the full sign-up flow so the example is end-to-end.
    const wallet = await SanctionAdminClient.createWallet(
      { name: "nightly-coding", ownerEmail: "founder@example.com" },
      opts,
    )
    walletId = wallet.id
    managementKey = wallet.managementKey // shown once — store it
    line(`Created wallet ${wallet.id} (mgmt key ${wallet.managementKeyPrefix}…)`)

    const admin = new SanctionAdminClient(managementKey, opts)
    const agent = await admin.registerAgent({ walletId, name: "nightly-coder" })
    agentApiKey = agent.apiKey // the agent's data-plane key (pxy_)
    line(`Registered agent ${agent.id} (api key ${agent.apiKeyPrefix}…)`)
  }

  // Apply the blueprint policy in ONE call (partial update; dollars in/out).
  const admin = new SanctionAdminClient(managementKey, opts)
  const applied = await admin.applyBlueprint(walletId, blueprint)
  line(
    `Applied blueprint "${blueprint._meta.blueprint}": ` +
      `auto-approve ≤ ${usd(applied.escalateOverUsd)}, ` +
      `escalate ${usd(applied.escalateOverUsd)}–${usd(applied.perTransactionMaxUsd)}, ` +
      `deny > ${usd(applied.perTransactionMaxUsd)}, daily cap ${usd(applied.dailySpendBudgetUsd)}`,
  )
  line(`Blocked categories: ${applied.blockedCategories.join(", ")}`)

  // In mock mode the vault is in-memory; seed the credentials the blueprint
  // declares so /exec + /inject have something to serve. (In live mode the
  // owner stores these via POST /credentials/vault ahead of time.)
  if (mock) {
    mock.seedCredential(walletId, { label: "github", type: "token", value: "ghp_MOCK_github_pat_do_not_use" })
    mock.seedCredential(walletId, { label: "vercel", type: "token", value: "vercel_MOCK_deploy_token" })
  }

  // =========================================================================
  // 2 + 3. AGENT SIDE — the overnight task loop.
  //    The agent only ever holds its pxy_ key. Before each costly/sensitive
  //    step it asks Sanction, then BRANCHES on the decision.
  // =========================================================================
  head("2. Overnight task loop (data plane: authorize + logTokens)")
  const sanction = new SanctionClient(agentApiKey, opts)

  // The agent's planned backlog for the night. Each item is a spend it wants to
  // make. Categories matter: `category` is an exact-match against the policy's
  // blocklist on the server, so tag spend honestly.
  const backlog = [
    {
      task: "task #42 — generate failing-test repro",
      action: "purchase" as const,
      amountUsd: 3.5,
      merchant: "anthropic",
      category: "software",
      description: "claude tokens to draft a repro",
      // expectation in the demo: APPROVED (≤ $5 escalate threshold)
    },
    {
      task: "task #43 — large refactor across 40 files",
      action: "purchase" as const,
      amountUsd: 12.0,
      merchant: "anthropic",
      category: "software",
      description: "claude tokens for a big multi-file refactor",
      // expectation: ESCALATED ($5 < $12 ≤ $20) — pauses for a human
    },
    {
      task: "task #44 — buy a 'growth' ad credit (off-mission)",
      action: "purchase" as const,
      amountUsd: 8.0,
      merchant: "ads-vendor",
      category: "marketing",
      description: "agent wandered off-mission",
      // expectation: DENIED — `marketing` is a blocked category
    },
  ]

  let approvedCount = 0
  let escalatedCount = 0

  for (const item of backlog) {
    line(`\n• ${item.task}  (${usd(item.amountUsd)}, category=${item.category})`)

    // The single most important call in the whole SDK. A `denied` decision is
    // RETURNED, not thrown — so we branch on decision.status instead of relying
    // on try/catch. (The SDK supports { throwOnDeny: true } for callers who
    // prefer exceptions, but branching is the governed-autonomy pattern.)
    const decision = await sanction.authorize({
      action: item.action,
      amountUsd: item.amountUsd,
      merchant: item.merchant,
      category: item.category,
      description: item.description,
      // An idempotency key makes retries safe: the same key replays the same
      // decision instead of double-charging budget.
      idempotencyKey: `${item.task}::step-1`,
    })

    await branchOnDecision(decision, {
      onApproved: async () => {
        approvedCount++
        line(`  → APPROVED (request ${decision.requestId}). Running the step…`)
        // The step actually ran and cost model tokens — record it for budget +
        // audit. logTokens is fire-and-forget-friendly.
        await sanction.logTokens({
          model: "claude-opus-4-8",
          tokensIn: 4200,
          tokensOut: 1800,
          costUsd: item.amountUsd, // demo: equate the token spend to the amount
          task: item.task,
        })
        line(`  → Logged token usage (${usd(item.amountUsd)}).`)
      },
      onEscalated: () => {
        escalatedCount++
        // Do NOT proceed. A human must approve. The agent should park this task
        // and move on — the escalation shows up as pendingApprovals in the
        // morning review and in the owner's Slack/email.
        line(`  → ESCALATED (${decision.code}). Parking task; a human must approve.`)
        line(`     hint: ${decision.remediation}`)
      },
      onDenied: () => {
        // The tool call never runs. The agent replans using the machine-readable
        // code + remediation — it does not retry blindly.
        line(`  → DENIED (${decision.code}). The spend is blocked; replanning.`)
        line(`     hint: ${decision.remediation}`)
      },
    })
  }

  // =========================================================================
  // 4. SCOPED CREDENTIAL INJECTION — open a PR using a GitHub token that only
  //    exists for ~15 minutes and only inside this execution.
  // =========================================================================
  head("3. Scoped credential injection (exec token → inject)")
  line("The approved refactor needs to push a branch + open a PR. The agent")
  line("requests a short-lived, scoped execution token and injects ONE secret.")

  // withCredential() does it in one call: request a 15-min execution JWT scoped
  // to ["github"], inject the `github` credential, run our callback with the
  // decrypted value, and let the token expire. The secret is never persisted by
  // the agent; every injection is audit-logged server-side.
  const prUrl = await sanction.withCredential(
    {
      scope: ["github"], // labels this execution is allowed to inject
      budgetUsd: 0, // pure credential access, no spend
      label: "github", // the one credential to inject from that scope
      ttlSeconds: 900, // ~15 minutes — matches the blueprint's vault TTL
    },
    async (githubToken, token) => {
      // `githubToken` is the decrypted credential, valid only for this window.
      // In a real agent you'd hand it to the GitHub API client here. We mask it.
      line(`  → exec token ${token.jti} issued, scope=[${token.scope.join(", ")}], expires ${token.expiresAt}`)
      line(`  → injected github credential: ${mask(githubToken)} (clearance ${token.clearance})`)
      // ... call GitHub: create branch, push, open PR ...
      return "https://github.com/acme/app/pull/451"
    },
  )
  line(`  → Opened PR: ${prUrl}`)

  // =========================================================================
  // 5. MORNING REVIEW — what happened overnight, from getStats().
  // =========================================================================
  head("4. Morning review (getStats)")
  const stats = await sanction.getStats(walletId)
  line(`Approved steps run : ${approvedCount}`)
  line(`Escalations waiting : ${escalatedCount} (need your approval)`)
  line(`Token cost today    : $${stats.today.tokenCostUsd.toFixed(2)}  (${stats.today.tokensIn} in / ${stats.today.tokensOut} out)`)
  line(`Approved spend today: $${stats.today.spendUsd.toFixed(2)}`)
  line(`Pending approvals   : ${stats.pendingApprovals}`)
  line(`Month-to-date spend : $${stats.month.spendUsd.toFixed(2)}`)
  line("\nDone. The agent ran autonomously; Sanction kept it on-budget,")
  line("on-mission, and fully audited.")
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Branch on a decision's status. This is the governed-autonomy control flow. */
function branchOnDecision(
  decision: Decision,
  handlers: { onApproved: () => Promise<void> | void; onEscalated: () => void; onDenied: () => void },
): Promise<void> | void {
  switch (decision.status) {
    case "approved":
      return handlers.onApproved()
    case "escalated":
    case "pending":
      return handlers.onEscalated()
    case "denied":
      return handlers.onDenied()
  }
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Live mode needs ${name}. Set it, or unset SANCTION_API_URL to run the offline mock.`)
    process.exit(1)
  }
  return v
}

function mask(secret: string): string {
  if (secret.length <= 8) return "****"
  return `${secret.slice(0, 4)}…${secret.slice(-2)}`
}

main().catch((err) => {
  console.error("\nExample failed:", err)
  process.exit(1)
})
