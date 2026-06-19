-- AlterTable: minimum agent clearance required to access a credential (1-5)
ALTER TABLE "CredentialVault" ADD COLUMN "minClearance" INTEGER NOT NULL DEFAULT 1;
