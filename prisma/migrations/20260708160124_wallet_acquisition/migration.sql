-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "acqCampaign" TEXT,
ADD COLUMN     "acqLanding" TEXT,
ADD COLUMN     "acqMedium" TEXT,
ADD COLUMN     "acqReferrer" TEXT,
ADD COLUMN     "acqSource" TEXT;

-- CreateIndex
CREATE INDEX "Wallet_acqSource_idx" ON "Wallet"("acqSource");
