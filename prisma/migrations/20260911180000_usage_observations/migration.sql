CREATE TABLE "UsageObservation" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "eventName" TEXT NOT NULL,
  "model" TEXT,
  "tokensIn" INTEGER,
  "tokensOut" INTEGER,
  "cacheReadTokens" INTEGER,
  "cacheWriteTokens" INTEGER,
  "estimatedCostUsd" DOUBLE PRECISION,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsageObservation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UsageObservation_agentId_source_eventId_key" ON "UsageObservation"("agentId", "source", "eventId");
CREATE INDEX "UsageObservation_agentId_occurredAt_idx" ON "UsageObservation"("agentId", "occurredAt");
CREATE INDEX "UsageObservation_agentId_source_receivedAt_idx" ON "UsageObservation"("agentId", "source", "receivedAt");
