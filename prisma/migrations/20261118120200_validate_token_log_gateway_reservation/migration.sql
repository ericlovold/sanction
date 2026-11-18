-- Validate separately so existing TokenLog rows can be scanned without
-- retaining the write-blocking lock used to add the foreign key.
ALTER TABLE "TokenLog" VALIDATE CONSTRAINT "TokenLog_gatewayReservationId_fkey";
