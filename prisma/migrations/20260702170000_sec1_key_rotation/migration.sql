-- SEC-1 Phase 2: WalletKey rotation. A wallet may now hold many keys — exactly
-- one active (enforced by a partial unique index), retired keys kept so blobs
-- written under them stay decryptable until lazily re-wrapped. Additive + idempotent.

ALTER TABLE "WalletKey" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WalletKey" ADD COLUMN IF NOT EXISTS "retiredAt" TIMESTAMP(3);

ALTER TABLE "WalletKey" DROP CONSTRAINT IF EXISTS "WalletKey_walletId_key";
DROP INDEX IF EXISTS "WalletKey_walletId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "WalletKey_one_active_per_wallet"
  ON "WalletKey"("walletId") WHERE "isActive";
CREATE INDEX IF NOT EXISTS "WalletKey_walletId_idx" ON "WalletKey"("walletId");
