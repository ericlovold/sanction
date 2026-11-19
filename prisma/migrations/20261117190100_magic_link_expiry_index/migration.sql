-- Keep this concurrent build as the only statement in this migration.
CREATE INDEX CONCURRENTLY "MagicLink_expiresAt_idx" ON "MagicLink"("expiresAt");
