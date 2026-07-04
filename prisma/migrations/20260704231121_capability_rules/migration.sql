-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "capabilityRules" JSONB NOT NULL DEFAULT '[]';
