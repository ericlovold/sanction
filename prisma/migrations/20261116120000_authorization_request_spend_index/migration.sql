-- Keep this concurrent build as the only statement in this migration.
CREATE INDEX CONCURRENTLY "AuthorizationRequest_agentId_status_decidedAt_idx"
  ON "AuthorizationRequest"("agentId", "status", "decidedAt");
