-- AlterEnum
ALTER TYPE "VersionCause" ADD VALUE 'REDONE';

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN "redo" JSONB;
