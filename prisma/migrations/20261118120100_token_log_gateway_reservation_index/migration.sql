-- Keep this concurrent build as the only statement in this migration.
-- Interrupted builds can leave an INVALID index with this name. Before retrying,
-- inspect pg_index.indisvalid for this index in the deployment database/schema.
-- Only if it is invalid, run DROP INDEX CONCURRENTLY "TokenLog_gatewayReservationId_key";
-- outside a transaction, then mark the failed migration rolled back:
-- npx prisma migrate resolve --rolled-back 20261118120100_token_log_gateway_reservation_index
-- Retry with npx prisma migrate deploy. Never drop a valid index or mark an
-- incomplete build applied. Recovery commands remain comments, not migration SQL.
CREATE UNIQUE INDEX CONCURRENTLY "TokenLog_gatewayReservationId_key" ON "TokenLog"("gatewayReservationId");
