-- CreateTable: owner-registered webhook endpoints
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY['escalation.created']::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Webhook_walletId_idx" ON "Webhook"("walletId");

ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
