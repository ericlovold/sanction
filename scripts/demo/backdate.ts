// History depth for the demo driver (docs/plans/demo-companies.md, PR2).
//
// The API only writes "now", so a 30-day history is generated day by day —
// real traffic through the real engine — and then shifted back in time with a
// direct-DB pass. Fabrication-lite, deliberately quarantined here:
//   · audit exports chain at export time, so shifted rows still verify;
//   · evidence replays from the stored context regardless of createdAt;
//   · WalletBudgetCounter rows are enforcement state keyed by period — after a
//     shift they'd overstate "today", so the involved wallets' counters are
//     deleted (they rebuild from zero on the next governed call).
//
// Requires an explicit DATABASE_URL — this file can never touch an API-only
// target, which is exactly the guard that keeps it away from prod by default.

import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
// pg ships with the repo via @prisma/adapter-pg — no new dependency.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require("pg") as typeof import("pg")

export async function backdateWindow(opts: {
  /** rows created at/after this instant get shifted */
  since: Date
  /** whole days to shift back */
  days: number
  /** agent ids whose rows are in scope (keeps the shift persona-scoped) */
  agentIds: string[]
  /** wallet ids whose budget counters must reset after the shift */
  walletIds: string[]
}) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("history mode needs DATABASE_URL (direct DB access for backdating)")
  const client = new Client({ connectionString: url })
  await client.connect()
  const shift = `${opts.days} days`
  try {
    await client.query("BEGIN")
    const auth = await client.query(
      `UPDATE "AuthorizationRequest" SET "createdAt" = "createdAt" - $1::interval,
              "decidedAt" = "decidedAt" - $1::interval
       WHERE "agentId" = ANY($2) AND "createdAt" >= $3`,
      [shift, opts.agentIds, opts.since],
    )
    const tokens = await client.query(
      `UPDATE "TokenLog" SET "createdAt" = "createdAt" - $1::interval
       WHERE "agentId" = ANY($2) AND "createdAt" >= $3`,
      [shift, opts.agentIds, opts.since],
    )
    await client.query(
      `UPDATE "PendingApproval" SET "createdAt" = "createdAt" - $1::interval,
              "resolvedAt" = "resolvedAt" - $1::interval
       WHERE "agentId" = ANY($2) AND "createdAt" >= $3`,
      [shift, opts.agentIds, opts.since],
    )
    await client.query(
      `UPDATE "Grant" SET "createdAt" = "createdAt" - $1::interval,
              "consumedAt" = "consumedAt" - $1::interval,
              "expiresAt" = "expiresAt" - $1::interval
       WHERE "agentId" = ANY($2) AND "createdAt" >= $3`,
      [shift, opts.agentIds, opts.since],
    )
    // Outcomes carry occurred_at from the API already; align createdAt with it.
    await client.query(
      `UPDATE "OutcomeEvent" SET "createdAt" = "occurredAt"
       WHERE "walletId" = ANY($1) AND "createdAt" >= $2`,
      [opts.walletIds, opts.since],
    )
    await client.query(`DELETE FROM "WalletBudgetCounter" WHERE "walletId" = ANY($1)`, [opts.walletIds])
    await client.query("COMMIT")
    return { authRows: auth.rowCount ?? 0, tokenRows: tokens.rowCount ?? 0 }
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    await client.end()
  }
}
