-- Keep this concurrent build as the only statement in this migration.
CREATE UNIQUE INDEX CONCURRENTLY "TokenLog_gatewayReservationId_key" ON "TokenLog"("gatewayReservationId");
