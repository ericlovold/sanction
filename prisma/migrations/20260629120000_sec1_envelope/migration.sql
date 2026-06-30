-- SEC-1 envelope encryption: per-wallet wrapped DEKs + a keyId stamp on
-- credentials. Additive (one new nullable column + one new table) — non-breaking.
-- Existing credentials keep keyId NULL and decrypt via the V2/V1/V0 fallthrough.

-- AlterTable
ALTER TABLE "CredentialVault" ADD COLUMN "keyId" TEXT;

-- CreateTable
CREATE TABLE "WalletKey" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "wrappedDek" TEXT NOT NULL,
    "keyRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletKey_walletId_key" ON "WalletKey"("walletId");
