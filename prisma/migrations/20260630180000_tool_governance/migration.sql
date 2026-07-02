-- Tool governance (ADR-0009 M3): authorize any MCP tool invocation the same way
-- spend is authorized. Additive, non-breaking; idempotent for safe retries.

ALTER TABLE "Policy" ADD COLUMN IF NOT EXISTS "allowedTools" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Policy" ADD COLUMN IF NOT EXISTS "blockedTools" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Policy" ADD COLUMN IF NOT EXISTS "escalateTools" TEXT[] DEFAULT ARRAY[]::TEXT[];
