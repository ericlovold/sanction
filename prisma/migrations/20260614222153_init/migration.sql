-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "apiKeyPrefix" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "dailyTokenBudgetUsd" INTEGER NOT NULL DEFAULT 1000,
    "dailySpendBudgetUsd" INTEGER NOT NULL DEFAULT 5000,
    "perTransactionMaxUsd" INTEGER NOT NULL DEFAULT 5000,
    "autoApproveUnderUsd" INTEGER NOT NULL DEFAULT 2500,
    "escalateOverUsd" INTEGER NOT NULL DEFAULT 10000,
    "allowedCategories" TEXT[] DEFAULT ARRAY['software', 'services', 'research', 'infrastructure']::TEXT[],
    "blockedCategories" TEXT[] DEFAULT ARRAY['gambling', 'adult', 'crypto']::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenLog" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL,
    "tokensOut" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "taskLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorizationRequest" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "merchant" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorizationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_ownerEmail_key" ON "Wallet"("ownerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_apiKeyHash_key" ON "Agent"("apiKeyHash");

-- CreateIndex
CREATE INDEX "Agent_walletId_idx" ON "Agent"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_walletId_key" ON "Policy"("walletId");

-- CreateIndex
CREATE INDEX "TokenLog_agentId_createdAt_idx" ON "TokenLog"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthorizationRequest_agentId_createdAt_idx" ON "AuthorizationRequest"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthorizationRequest_status_idx" ON "AuthorizationRequest"("status");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenLog" ADD CONSTRAINT "TokenLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorizationRequest" ADD CONSTRAINT "AuthorizationRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
