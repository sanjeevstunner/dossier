-- AlterEnum
ALTER TYPE "ApplicationStatus" ADD VALUE 'SCORED';

-- AlterTable
ALTER TABLE "Application" ADD COLUMN "score" INTEGER,
ADD COLUMN "scoreReasons" JSONB,
ADD COLUMN "scoreRedFlags" JSONB;
