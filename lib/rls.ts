/**
 * SEC-3: Postgres Row-Level Security (RLS) tenant scoping.
 *
 * `withTenant(walletId, fn)` opens a transaction, sets the transaction-local
 * `app.wallet_id` GUC that the RLS policies key on, then runs `fn` against the
 * scoped transaction client. Any query `fn` makes against an RLS-protected table
 * (currently CredentialVault — the crown jewel) can ONLY see or write rows for
 * `walletId`, even if the query forgets its `where` clause. This is the
 * DB-level backstop beneath the app-layer `walletId` filtering.
 *
 * IMPORTANT — the app's DB role MUST be non-superuser for RLS to take effect.
 * Postgres bypasses RLS for superusers, and for a table's owner unless the table
 * is set to FORCE ROW LEVEL SECURITY (the migration does set FORCE, so a
 * non-superuser owner — e.g. Neon's default role — is correctly subject). Never
 * run the app as a superuser; tests verify isolation against a non-superuser role.
 */

import { db } from "./db"
import type { Prisma } from "./generated/prisma/client"

/**
 * Run `fn` with RLS scoped to one tenant — or, for the account-tree case, a set
 * of tenants (a parent reading its subtree). The policies key on membership in
 * `app.wallet_ids` (comma-joined), so the single-id and subtree cases share one
 * primitive. Pass a single walletId for the common case; pass the BFS'd subtree
 * id list for `/wallets/tree`.
 */
export function withTenant<T>(
  wallet: string | string[],
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const ids = (Array.isArray(wallet) ? wallet : [wallet]).filter(Boolean)
  return db.$transaction(async (tx) => {
    // Transaction-local (is_local=true): auto-resets at COMMIT/ROLLBACK, so it
    // can never leak to another tenant on a pooled connection. The CSV is a
    // bound parameter (cuids contain no commas → no injection / no ambiguity).
    await tx.$executeRaw`SELECT set_config('app.wallet_ids', ${ids.join(",")}, true)`
    return fn(tx)
  })
}
