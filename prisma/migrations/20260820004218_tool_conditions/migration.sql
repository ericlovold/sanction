-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "toolConditions" JSONB NOT NULL DEFAULT '[]';
