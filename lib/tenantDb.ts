import { Prisma } from "./generated/prisma/client"
import { db } from "./db"

/**
 * Tenant-isolated database access (SEC-3, Postgres Row-Level Security).
 *
 * Defense in depth: app-code `where: { walletId }` filtering is one typo away
 * from a cross-tenant breach. RLS makes the database itself refuse to return
 * another tenant's rows, even if the app forgets (or fat-fingers) the filter.
 *
 * How it works:
 *   - The migration enables RLS on tenant-scoped tables and adds policies that
 *     compare each row's `walletId` to `current_setting('app.current_wallet')`.
 *   - `withTenant` opens a transaction, runs `SET LOCAL app.current_wallet = $id`
 *     (scoped to that transaction only — `LOCAL` resets at commit/rollback, so a
 *     pooled connection can't leak the setting into the next request), then runs
 *     the caller's queries through the transaction client. Every read/write in
 *     the callback is automatically tenant-scoped by the DB.
 *
 * IMPORTANT: the app's Postgres role must NOT have BYPASSRLS, or the policies are
 * silently skipped. The migration documents this; verify the Neon role.
 *
 * Usage:
 *   await withTenant(walletId, async (tx) => {
 *     return tx.credentialVault.findMany()   // no `where: { walletId }` needed
 *   })
 *
 * `SET LOCAL` cannot bind parameters, so `walletId` is validated against a strict
 * allow-list charset before interpolation to foreclose any SQL-injection vector.
 */

// Wallet ids are cuids (and historically cuid2). Allow a conservative superset:
// alphanumerics, dash, underscore. Reject anything else outright.
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

export type TenantTx = Prisma.TransactionClient

export async function withTenant<T>(
  walletId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!SAFE_ID.test(walletId)) {
    throw new Error("Invalid walletId for tenant context")
  }
  return db.$transaction(async (tx) => {
    // set_config(setting, value, is_local=true): parameterized, so no string
    // interpolation into SQL. is_local=true scopes it to this transaction.
    await tx.$executeRaw`SELECT set_config('app.current_wallet', ${walletId}, true)`
    return fn(tx)
  })
}
