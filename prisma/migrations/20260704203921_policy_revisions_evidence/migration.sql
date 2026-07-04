-- AlterTable
ALTER TABLE "AuthorizationRequest" ADD COLUMN     "decisionContextJson" JSONB,
ADD COLUMN     "policyRevision" INTEGER;

-- AlterTable
ALTER TABLE "Grant" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PendingApproval" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "currentRevision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "PolicyRevision" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PolicyRevision_walletId_createdAt_idx" ON "PolicyRevision"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRevision_policyId_revision_key" ON "PolicyRevision"("policyId", "revision");

-- AddForeignKey
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing policy gets revision 1 from its current values, so
-- "what policy was in force" is answerable from the moment this migration runs.
INSERT INTO "PolicyRevision" ("id", "policyId", "walletId", "revision", "snapshotJson", "createdAt")
SELECT
  'prev_' || md5(p."id" || random()::text),
  p."id",
  p."walletId",
  1,
  to_jsonb(p) - 'id' - 'walletId' - 'currentRevision' - 'updatedAt',
  now()
FROM "Policy" p;
