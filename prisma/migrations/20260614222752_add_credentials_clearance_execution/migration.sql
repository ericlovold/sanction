-- CreateTable
CREATE TABLE "CredentialVault" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "allowedAgentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CredentialVault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentClearance" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "industry" TEXT NOT NULL DEFAULT 'general',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "restrictions" JSONB,

    CONSTRAINT "AgentClearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionToken" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "scope" TEXT[],
    "budgetUsd" DOUBLE PRECISION NOT NULL,
    "spentUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clearance" INTEGER NOT NULL DEFAULT 1,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "containerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "ExecutionToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialInjection" (
    "id" TEXT NOT NULL,
    "executionTokenId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "injectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialInjection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CredentialVault_walletId_idx" ON "CredentialVault"("walletId");

-- CreateIndex
CREATE INDEX "AgentClearance_agentId_idx" ON "AgentClearance"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentClearance_walletId_agentId_key" ON "AgentClearance"("walletId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentClearance_agentId_key" ON "AgentClearance"("agentId");

-- CreateIndex
CREATE INDEX "ExecutionToken_agentId_idx" ON "ExecutionToken"("agentId");

-- CreateIndex
CREATE INDEX "ExecutionToken_status_expiresAt_idx" ON "ExecutionToken"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "CredentialInjection_executionTokenId_idx" ON "CredentialInjection"("executionTokenId");

-- AddForeignKey
ALTER TABLE "CredentialVault" ADD CONSTRAINT "CredentialVault_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentClearance" ADD CONSTRAINT "AgentClearance_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentClearance" ADD CONSTRAINT "AgentClearance_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionToken" ADD CONSTRAINT "ExecutionToken_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionToken" ADD CONSTRAINT "ExecutionToken_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialInjection" ADD CONSTRAINT "CredentialInjection_executionTokenId_fkey" FOREIGN KEY ("executionTokenId") REFERENCES "ExecutionToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialInjection" ADD CONSTRAINT "CredentialInjection_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "CredentialVault"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
