-- Account tree: additive parent linkage on Wallet. Nullable, so every existing
-- wallet remains a root (parentId = NULL). No changes to existing columns or
-- constraints — non-breaking.

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Wallet_parentId_idx" ON "Wallet"("parentId");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
