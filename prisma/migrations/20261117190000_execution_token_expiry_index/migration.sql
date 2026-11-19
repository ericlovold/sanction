-- Keep this concurrent build as the only statement in this migration.
CREATE INDEX CONCURRENTLY "ExecutionToken_expiresAt_idx" ON "ExecutionToken"("expiresAt");
