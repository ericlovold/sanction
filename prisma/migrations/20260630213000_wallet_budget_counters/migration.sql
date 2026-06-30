-- Cascade budget enforcement counters.
-- One row per wallet per period. Values are cents, updated atomically in the
-- /authorize hot path so ancestor wallet caps cannot be overrun by concurrent
-- agents under the same subtree.
CREATE TABLE "WalletBudgetCounter" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "spentCents" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WalletBudgetCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WalletBudgetCounter_walletId_period_periodStart_key"
  ON "WalletBudgetCounter"("walletId", "period", "periodStart");

CREATE INDEX "WalletBudgetCounter_period_periodStart_idx"
  ON "WalletBudgetCounter"("period", "periodStart");

ALTER TABLE "WalletBudgetCounter"
  ADD CONSTRAINT "WalletBudgetCounter_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill today's approved spend into every wallet in each approved request's
-- ancestor chain. Historical days stay report-only; enforcement starts from the
-- current daily window.
WITH RECURSIVE approved AS (
  SELECT ar.id, ar."amountUsd", a."walletId"
  FROM "AuthorizationRequest" ar
  JOIN "Agent" a ON a.id = ar."agentId"
  WHERE ar.status = 'approved'
    AND ar."createdAt" >= date_trunc('day', now())
), ancestors AS (
  SELECT approved.id, approved."amountUsd", w.id AS "walletId", w."parentId"
  FROM approved
  JOIN "Wallet" w ON w.id = approved."walletId"
  UNION ALL
  SELECT ancestors.id, ancestors."amountUsd", parent.id AS "walletId", parent."parentId"
  FROM ancestors
  JOIN "Wallet" parent ON parent.id = ancestors."parentId"
), rolled AS (
  SELECT "walletId", SUM(ROUND("amountUsd" * 100))::int AS cents
  FROM ancestors
  GROUP BY "walletId"
)
INSERT INTO "WalletBudgetCounter" ("id", "walletId", "period", "periodStart", "spentCents", "updatedAt")
SELECT gen_random_uuid()::text, "walletId", 'daily', date_trunc('day', now()), cents, now()
FROM rolled
ON CONFLICT ("walletId", "period", "periodStart")
DO UPDATE SET "spentCents" = EXCLUDED."spentCents", "updatedAt" = EXCLUDED."updatedAt";
