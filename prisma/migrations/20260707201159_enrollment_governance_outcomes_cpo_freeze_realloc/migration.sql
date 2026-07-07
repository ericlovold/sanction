-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "costPerOutcomeCeilingUsd" INTEGER,
ADD COLUMN     "costPerOutcomeMinOutcomes" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "costPerOutcomeWindowDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "outcomeKind" TEXT;

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "frozenAt" TIMESTAMP(3),
ADD COLUMN     "frozenReason" TEXT;

-- CreateTable
CREATE TABLE "OutcomeEvent" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "agentId" TEXT,
    "kind" TEXT NOT NULL,
    "valueUsd" DOUBLE PRECISION,
    "playLabel" TEXT,
    "dedupeKey" TEXT,
    "metadataJson" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutcomeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetReallocation" (
    "id" TEXT NOT NULL,
    "fromWalletId" TEXT NOT NULL,
    "toWalletId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "budget" TEXT NOT NULL DEFAULT 'subtree_daily_cap',
    "reason" TEXT,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetReallocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutcomeEvent_walletId_kind_occurredAt_idx" ON "OutcomeEvent"("walletId", "kind", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutcomeEvent_walletId_dedupeKey_key" ON "OutcomeEvent"("walletId", "dedupeKey");

-- CreateIndex
CREATE INDEX "BudgetReallocation_fromWalletId_createdAt_idx" ON "BudgetReallocation"("fromWalletId", "createdAt");

-- CreateIndex
CREATE INDEX "BudgetReallocation_toWalletId_createdAt_idx" ON "BudgetReallocation"("toWalletId", "createdAt");

-- AddForeignKey
ALTER TABLE "OutcomeEvent" ADD CONSTRAINT "OutcomeEvent_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetReallocation" ADD CONSTRAINT "BudgetReallocation_fromWalletId_fkey" FOREIGN KEY ("fromWalletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetReallocation" ADD CONSTRAINT "BudgetReallocation_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
