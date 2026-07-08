-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "monthlyTokenBudgetUsd" INTEGER;

-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "monthlyTokenBudgetUsd" INTEGER,
ADD COLUMN     "subtreeDailyTokenCapUsd" INTEGER;
