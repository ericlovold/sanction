-- AlterTable: per-agent budget overrides (nullable; null = inherit the wallet policy)
ALTER TABLE "Agent" ADD COLUMN "dailyTokenBudgetUsd" INTEGER;
ALTER TABLE "Agent" ADD COLUMN "dailySpendBudgetUsd" INTEGER;
ALTER TABLE "Agent" ADD COLUMN "perTransactionMaxUsd" INTEGER;
ALTER TABLE "Agent" ADD COLUMN "escalateOverUsd" INTEGER;
