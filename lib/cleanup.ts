import { db } from "./db"
import { scopeTenant } from "./rls"
import { Prisma } from "./generated/prisma/client"

export const CLEANUP_BATCH_SIZE = 1_000
export const EXECUTION_TOKEN_RETENTION_MS = 30 * 86_400_000
export const TRANSIENT_RETENTION_MS = 86_400_000

async function cleanupExecutionTokens(walletIds: string[], cutoff: Date) {
  return db.$transaction(async (tx) => {
    await scopeTenant(tx, walletIds)
    const candidates = await tx.$queryRaw<{ id: string }[]>`
      SELECT token.id FROM "ExecutionToken" token
      WHERE token."walletId" = ANY(${walletIds}::text[])
        AND token."expiresAt" < ${cutoff}
        AND token."spentUsd" = 0
        AND NOT EXISTS (
          SELECT 1 FROM "CredentialInjection" injection WHERE injection."executionTokenId" = token.id
        )
      ORDER BY token."expiresAt", token.id
      LIMIT ${CLEANUP_BATCH_SIZE}
      FOR UPDATE OF token SKIP LOCKED
    `
    let retained = 0

    async function deleteGroup(ids: string[]): Promise<number> {
      await tx.$executeRaw`SAVEPOINT cleanup_tokens`
      try {
        const count = await tx.$executeRaw`
          DELETE FROM "ExecutionToken" token
          WHERE token.id = ANY(${ids}::text[])
            AND token."walletId" = ANY(${walletIds}::text[])
            AND token."expiresAt" < ${cutoff}
            AND token."spentUsd" = 0
            AND NOT EXISTS (
              SELECT 1 FROM "CredentialInjection" injection WHERE injection."executionTokenId" = token.id
            )
        `
        await tx.$executeRaw`RELEASE SAVEPOINT cleanup_tokens`
        return count
      } catch (error) {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT cleanup_tokens`
        await tx.$executeRaw`RELEASE SAVEPOINT cleanup_tokens`
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2010") throw error
        const adapterError = error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined
        if (error.meta?.code !== "23503" && adapterError?.cause?.originalCode !== "23503") throw error
        // Legacy cross-wallet injections can be hidden by RLS while their FK
        // still protects the token. Bisect only failing groups so that one such
        // token cannot abort cleanup of every unrelated candidate.
        if (ids.length === 1) {
          retained++
          return 0
        }
        const middle = Math.floor(ids.length / 2)
        return await deleteGroup(ids.slice(0, middle)) + await deleteGroup(ids.slice(middle))
      }
    }

    const deleted = candidates.length ? await deleteGroup(candidates.map((row) => row.id)) : 0
    return { deleted, retained, full: candidates.length === CLEANUP_BATCH_SIZE }
  }, { timeout: 20_000 })
}

// A system cron enumerates wallet IDs only. Token deletion still uses the
// restricted app role, a transaction-local tenant scope, and an explicit
// wallet predicate. Credential-injection and spend evidence retain the token.
export async function cleanupExpiredRecords(now = new Date()) {
  const executionCutoff = new Date(now.getTime() - EXECUTION_TOKEN_RETENTION_MS)
  const transientCutoff = new Date(now.getTime() - TRANSIENT_RETENTION_MS)
  const wallets = await db.wallet.findMany({ select: { id: true } })
  const walletIds = wallets.map((wallet) => wallet.id)
  let retainedExecutionTokens = 0
  let executionBatchFull = false

  const batches = {
    executionTokens: async () => {
      if (walletIds.length === 0) return 0
      const result = await cleanupExecutionTokens(walletIds, executionCutoff)
      retainedExecutionTokens = result.retained
      executionBatchFull = result.full
      return result.deleted
    },
    magicLinks: () => db.$executeRaw`
      WITH candidates AS (
        SELECT id FROM "MagicLink"
        WHERE "walletId" = ANY(${walletIds}::text[]) AND "expiresAt" < ${transientCutoff}
        ORDER BY "expiresAt", id
        LIMIT ${CLEANUP_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "MagicLink" link USING candidates
      WHERE link.id = candidates.id
        AND link."walletId" = ANY(${walletIds}::text[]) AND link."expiresAt" < ${transientCutoff}
    `,
    // Better Auth stores verified email sign-in links here, along with other
    // expiring verification values. These rows have no wallet association.
    verifications: () => db.$executeRaw`
      WITH candidates AS (
        SELECT id FROM verification WHERE "expiresAt" < ${transientCutoff}
        ORDER BY "expiresAt", id
        LIMIT ${CLEANUP_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM verification value USING candidates
      WHERE value.id = candidates.id AND value."expiresAt" < ${transientCutoff}
    `,
    rateLimits: () => db.$executeRaw`
      WITH candidates AS (
        SELECT key FROM "RateLimit" WHERE "windowEnd" < ${transientCutoff}
        ORDER BY "windowEnd", key
        LIMIT ${CLEANUP_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "RateLimit" counter USING candidates
      WHERE counter.key = candidates.key AND counter."windowEnd" < ${transientCutoff}
    `,
  }
  type Table = keyof typeof batches
  const deleted = { executionTokens: 0, magicLinks: 0, verifications: 0, rateLimits: 0 }
  const batchFull: Table[] = []
  const failed: Table[] = []

  // Each statement is atomic and row-locks its candidates. Overlapping runs
  // skip locked rows; a rate-limit upsert cannot lose a renewed active window.
  // Separate transactions preserve progress if one table fails.
  for (const table of Object.keys(batches) as Table[]) {
    try {
      deleted[table] = await batches[table]()
      if (deleted[table] === CLEANUP_BATCH_SIZE || (table === "executionTokens" && executionBatchFull)) batchFull.push(table)
    } catch (error) {
      console.error(`expired-record cleanup failed for ${table}`, error)
      failed.push(table)
    }
  }
  return { deleted, batchFull, failed, retainedExecutionTokens }
}
