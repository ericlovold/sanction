-- AlterTable: add owner management key to Wallet (nullable; pre-existing wallets fail closed until bootstrapped)
ALTER TABLE "Wallet" ADD COLUMN "mgmtKeyHash" TEXT;
ALTER TABLE "Wallet" ADD COLUMN "mgmtKeyPrefix" TEXT;

-- AlterTable: add idempotency key to AuthorizationRequest
ALTER TABLE "AuthorizationRequest" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_mgmtKeyHash_key" ON "Wallet"("mgmtKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorizationRequest_agentId_idempotencyKey_key" ON "AuthorizationRequest"("agentId", "idempotencyKey");
