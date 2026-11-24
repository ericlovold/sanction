-- AI spend connectors (observe layer): pull usage and cost from provider admin
-- APIs into one normalized fact table. Additive only; no existing table changes.
--
-- UsageFact, UsageSyncRun and UsageAlert hold tenant usage data (identities,
-- spend, evidence), so they get the same FORCE RLS backstop as the vault: a
-- forgotten where clause cannot read another wallet's numbers. UsageConnection
-- is non-secret metadata the cross-tenant poller must enumerate, so it is not
-- under RLS (the credential it points at is, in CredentialVault).
-- CreateTable
CREATE TABLE "UsageConnection" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "authKind" TEXT NOT NULL,
    "credentialId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "statusCode" TEXT,
    "statusDetail" TEXT,
    "connectedByEmail" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "syncedThrough" TIMESTAMP(3),

    CONSTRAINT "UsageConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageFact" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "rawIdentity" TEXT NOT NULL,
    "identityType" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "sessionRef" TEXT,
    "automationRef" TEXT,
    "headless" BOOLEAN NOT NULL DEFAULT false,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "bucketEnd" TIMESTAMP(3) NOT NULL,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "cacheReadTokens" BIGINT NOT NULL DEFAULT 0,
    "cacheWriteTokens" BIGINT NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "costNanos" BIGINT NOT NULL,
    "costBasis" TEXT NOT NULL,
    "sourceRefreshedAt" TIMESTAMP(3) NOT NULL,
    "dedupeKey" TEXT NOT NULL,

    CONSTRAINT "UsageFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageSyncRun" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "actorEmail" TEXT,
    "endpoint" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "httpCalls" INTEGER NOT NULL DEFAULT 0,
    "factsWritten" INTEGER NOT NULL DEFAULT 0,
    "alertsRaised" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "UsageSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageAlert" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "connectionId" TEXT,
    "rule" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "observedNanos" BIGINT NOT NULL,
    "thresholdNanos" BIGINT NOT NULL,
    "evidence" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "UsageAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageConnection_walletId_provider_key" ON "UsageConnection"("walletId", "provider");

-- CreateIndex
CREATE INDEX "UsageConnection_status_lastAttemptAt_idx" ON "UsageConnection"("status", "lastAttemptAt");

-- CreateIndex
CREATE INDEX "UsageFact_walletId_bucketStart_idx" ON "UsageFact"("walletId", "bucketStart");

-- CreateIndex
CREATE INDEX "UsageFact_connectionId_bucketStart_idx" ON "UsageFact"("connectionId", "bucketStart");

-- CreateIndex
CREATE INDEX "UsageFact_walletId_rawIdentity_bucketStart_idx" ON "UsageFact"("walletId", "rawIdentity", "bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "UsageFact_connectionId_dedupeKey_key" ON "UsageFact"("connectionId", "dedupeKey");

-- CreateIndex
CREATE INDEX "UsageSyncRun_walletId_startedAt_idx" ON "UsageSyncRun"("walletId", "startedAt");

-- CreateIndex
CREATE INDEX "UsageSyncRun_connectionId_startedAt_idx" ON "UsageSyncRun"("connectionId", "startedAt");

-- CreateIndex
CREATE INDEX "UsageAlert_walletId_createdAt_idx" ON "UsageAlert"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageAlert_walletId_dedupeKey_key" ON "UsageAlert"("walletId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "UsageConnection" ADD CONSTRAINT "UsageConnection_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageFact" ADD CONSTRAINT "UsageFact_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "UsageConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageSyncRun" ADD CONSTRAINT "UsageSyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "UsageConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageAlert" ADD CONSTRAINT "UsageAlert_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "UsageConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SEC-3: tenant isolation at the data layer.
ALTER TABLE "UsageFact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageFact" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "UsageFact"
  USING ("walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ',')))
  WITH CHECK ("walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ',')));

ALTER TABLE "UsageSyncRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageSyncRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "UsageSyncRun"
  USING ("walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ',')))
  WITH CHECK ("walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ',')));

ALTER TABLE "UsageAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageAlert" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "UsageAlert"
  USING ("walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ',')))
  WITH CHECK ("walletId" = ANY(string_to_array(current_setting('app.wallet_ids', true), ',')));
