-- CreateTable
CREATE TABLE "WalletDecisionCounter" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletDecisionCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletDecisionCounter_walletId_month_key" ON "WalletDecisionCounter"("walletId", "month");

-- AddForeignKey
ALTER TABLE "WalletDecisionCounter" ADD CONSTRAINT "WalletDecisionCounter_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
