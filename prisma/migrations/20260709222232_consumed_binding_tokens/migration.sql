-- CreateTable
CREATE TABLE "ConsumedBindingToken" (
    "jti" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumedBindingToken_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "ConsumedBindingToken_expiresAt_idx" ON "ConsumedBindingToken"("expiresAt");
