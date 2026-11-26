-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "syncedFrom" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Application_syncedFrom_externalId_key" ON "Application"("syncedFrom", "externalId");
