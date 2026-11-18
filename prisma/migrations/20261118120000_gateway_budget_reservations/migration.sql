CREATE TABLE "GatewayReservation" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "reservedUsd" DOUBLE PRECISION NOT NULL,
    "inputRateUsdPerMillion" DOUBLE PRECISION NOT NULL,
    "outputRateUsdPerMillion" DOUBLE PRECISION NOT NULL,
    "observedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    CONSTRAINT "GatewayReservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GatewayReservation_status_check" CHECK ("status" IN ('pending', 'uncertain', 'settled', 'released')),
    CONSTRAINT "GatewayReservation_amounts_check" CHECK (
      "reservedUsd" >= 0 AND "reservedUsd" < 'Infinity'::float8
      AND "observedUsd" >= 0 AND "observedUsd" < 'Infinity'::float8
      AND "inputRateUsdPerMillion" >= 0 AND "inputRateUsdPerMillion" < 'Infinity'::float8
      AND "outputRateUsdPerMillion" >= 0 AND "outputRateUsdPerMillion" < 'Infinity'::float8
    )
);

ALTER TABLE "TokenLog" ADD COLUMN "gatewayReservationId" TEXT;
CREATE INDEX "GatewayReservation_agentId_status_idx" ON "GatewayReservation"("agentId", "status");
CREATE INDEX "GatewayReservation_walletId_status_idx" ON "GatewayReservation"("walletId", "status");
ALTER TABLE "GatewayReservation" ADD CONSTRAINT "GatewayReservation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GatewayReservation" ADD CONSTRAINT "GatewayReservation_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TokenLog" ADD CONSTRAINT "TokenLog_gatewayReservationId_fkey" FOREIGN KEY ("gatewayReservationId") REFERENCES "GatewayReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
