-- Monthly spend cap (opt-in). Additive + nullable: existing policies keep NULL
-- (no monthly limit) with zero backfill and no behavior change.
ALTER TABLE "Policy" ADD COLUMN "monthlySpendBudgetUsd" INTEGER;
