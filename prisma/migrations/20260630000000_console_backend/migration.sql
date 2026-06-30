-- Console backend: a "last used" stamp on agents (for the API-keys console) and
-- a soft-retire timestamp on credentials (retire without losing the audit
-- trail). Additive, non-breaking; idempotent for safe retries.

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3);

ALTER TABLE "CredentialVault" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);
