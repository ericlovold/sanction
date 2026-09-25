-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "ownerEmailVerifiedAt" TIMESTAMP(3);

-- Backfill: a wallet linked to a User was claimed or provisioned through a
-- provider-verified social sign-in, so its ownerEmail is already proven.
UPDATE "Wallet" SET "ownerEmailVerifiedAt" = now() WHERE "userId" IS NOT NULL;
