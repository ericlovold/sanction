-- Provider-side account a connector reads (the GitHub org for Copilot).
-- Additive and nullable: existing connections keep working unchanged.
ALTER TABLE "UsageConnection" ADD COLUMN "accountRef" TEXT;
