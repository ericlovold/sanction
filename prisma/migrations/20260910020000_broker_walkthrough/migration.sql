CREATE TABLE "BrokerWalkthrough" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "ownerWalletId" TEXT NOT NULL,
 "testWalletId" TEXT NOT NULL,
 "agentId" TEXT NOT NULL,
 "upstreamTokenHash" TEXT NOT NULL,
 "encryptedAgentKey" TEXT,
 "keyId" TEXT,
 "state" TEXT NOT NULL DEFAULT 'initializing',
 "requestId" TEXT,
 "initialStopped" BOOLEAN NOT NULL DEFAULT false,
 "changedStopped" BOOLEAN NOT NULL DEFAULT false,
 "reuseStopped" BOOLEAN NOT NULL DEFAULT false,
 "executionCount" INTEGER NOT NULL DEFAULT 0,
 "completedAt" TIMESTAMP(3),
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "BrokerWalkthrough_testWalletId_key" ON "BrokerWalkthrough"("testWalletId");
CREATE UNIQUE INDEX "BrokerWalkthrough_agentId_key" ON "BrokerWalkthrough"("agentId");
CREATE INDEX "BrokerWalkthrough_ownerWalletId_createdAt_idx" ON "BrokerWalkthrough"("ownerWalletId", "createdAt");
