-- Keep this concurrent build as the only statement in this migration.
CREATE INDEX CONCURRENTLY "ExecutionToken_walletId_status_idx"
  ON "ExecutionToken"("walletId", "status");
