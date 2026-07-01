-- Additive subtree cap for parent-wallet enforcement.
-- dailySpendBudgetUsd remains the existing per-agent default; this nullable cap
-- is the opt-in tree-wide budget enforced across wallet ancestors.
ALTER TABLE "Policy" ADD COLUMN "subtreeDailyCapUsd" INTEGER;
