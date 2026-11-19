-- Keep this concurrent build as the only statement in this migration.
CREATE INDEX CONCURRENTLY "verification_expiresAt_idx" ON "verification"("expiresAt");
