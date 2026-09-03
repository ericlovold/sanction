-- Better Auth 1.7 keys social accounts on (issuer, accountId). The live
-- Prisma adapter runs findAccountOwnerByKey({ issuer, accountId }) on every
-- OAuth callback; without this column the generated client throws
-- PrismaClientValidationError ("Unknown argument `issuer`") and Google /
-- GitHub / Apple sign-in 302s fail closed.
--
-- issuer stays nullable so a populated 1.6 table can gain the column. The
-- backfill uses the issuer strings better-auth@1.7.2 actually writes
-- (verified in the installed package: google.accountIssuer,
-- apple.accountIssuer, createOAuthAccountIssuer("github")).

-- AlterTable
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" TEXT;

UPDATE "account" SET "issuer" = 'https://accounts.google.com'
WHERE "providerId" = 'google' AND "issuer" IS NULL;

UPDATE "account" SET "issuer" = 'local:oauth:github'
WHERE "providerId" = 'github' AND "issuer" IS NULL;

UPDATE "account" SET "issuer" = 'https://appleid.apple.com'
WHERE "providerId" = 'apple' AND "issuer" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_accountId_key" ON "account"("issuer", "accountId");
