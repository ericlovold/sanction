-- Provision authorization (design-partner pilot, DESIGN-PARTNER.md build #1):
-- a first-class "provision" action shape (resource + line-item + quantity + $)
-- through the same decision engine and approval/grant workflow as spend.
-- Additive, non-breaking; idempotent for safe retries.

ALTER TABLE "AuthorizationRequest" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'spend';
ALTER TABLE "AuthorizationRequest" ADD COLUMN IF NOT EXISTS "detailsJson" JSONB;

ALTER TABLE "Policy" ADD COLUMN IF NOT EXISTS "allowedResources" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Policy" ADD COLUMN IF NOT EXISTS "blockedResources" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Policy" ADD COLUMN IF NOT EXISTS "escalateResources" TEXT[] DEFAULT ARRAY[]::TEXT[];
