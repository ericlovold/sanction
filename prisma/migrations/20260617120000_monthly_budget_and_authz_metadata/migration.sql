-- Policy: optional monthly spend cap (null = no monthly cap).
ALTER TABLE "Policy" ADD COLUMN "monthlySpendBudgetUsd" INTEGER;

-- AuthorizationRequest: attribution metadata for per-task reporting.
ALTER TABLE "AuthorizationRequest" ADD COLUMN "taskLabel" TEXT;
ALTER TABLE "AuthorizationRequest" ADD COLUMN "jobId" TEXT;
ALTER TABLE "AuthorizationRequest" ADD COLUMN "repo" TEXT;
ALTER TABLE "AuthorizationRequest" ADD COLUMN "toolName" TEXT;
