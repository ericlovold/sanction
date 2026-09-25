-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "ownerEmailVerifiedAt" TIMESTAMP(3);

-- Backfill: only where there is evidence. Provisioning never checked
-- emailVerified, so a linked userId alone is not proof — require the linked
-- User's provider-verified email to be this wallet's ownerEmail.
UPDATE "Wallet" w SET "ownerEmailVerifiedAt" = now()
FROM "user" u
WHERE w."userId" = u."id"
  AND u."emailVerified" = true
  AND lower(u."email") = lower(w."ownerEmail");
