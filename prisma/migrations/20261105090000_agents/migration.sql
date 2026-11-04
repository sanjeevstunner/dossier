-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "AgentCandidate" ADD COLUMN     "agentId" TEXT,
ADD COLUMN     "runId" TEXT;

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Job agent',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "query" JSONB NOT NULL,
    "hour" INTEGER NOT NULL DEFAULT 7,
    "days" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
    "minScore" INTEGER NOT NULL DEFAULT 70,
    "maxScores" INTEGER NOT NULL DEFAULT 15,
    "maxDrafts" INTEGER NOT NULL DEFAULT 3,
    "autoDraft" BOOLEAN NOT NULL DEFAULT false,
    "maxRunsPerDay" INTEGER NOT NULL DEFAULT 3,
    "manualIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "message" TEXT,
    "found" INTEGER NOT NULL DEFAULT 0,
    "fresh" INTEGER NOT NULL DEFAULT 0,
    "scored" INTEGER NOT NULL DEFAULT 0,
    "drafted" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_agentId_startedAt_idx" ON "AgentRun"("agentId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentCandidate_agentId_status_idx" ON "AgentCandidate"("agentId", "status");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCandidate" ADD CONSTRAINT "AgentCandidate_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCandidate" ADD CONSTRAINT "AgentCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Port the one job agent kept in Settings (E16) to an Agent, with its runs
-- and candidates. Settings are text: flags "true"/"false", numbers, JSON.
INSERT INTO "Agent" ("id", "name", "enabled", "query", "hour", "minScore", "maxScores", "maxDrafts", "autoDraft", "updatedAt")
SELECT
  'job-agent',
  'Job agent',
  COALESCE((SELECT value FROM "Setting" WHERE key = 'agentEnabled'), 'false') = 'true',
  COALESCE((SELECT value::jsonb FROM "Setting" WHERE key = 'agentQuery' AND value LIKE '{%'), '{}'::jsonb),
  COALESCE((SELECT value::int FROM "Setting" WHERE key = 'agentHour' AND value ~ '^\d{1,2}$'), 7),
  COALESCE((SELECT value::int FROM "Setting" WHERE key = 'agentMinScore' AND value ~ '^\d{1,3}$'), 70),
  COALESCE((SELECT value::int FROM "Setting" WHERE key = 'agentMaxScores' AND value ~ '^\d{1,2}$'), 15),
  COALESCE((SELECT value::int FROM "Setting" WHERE key = 'agentMaxDrafts' AND value ~ '^\d{1,2}$'), 3),
  COALESCE((SELECT value FROM "Setting" WHERE key = 'agentAutoDraft'), 'false') = 'true',
  CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Setting" WHERE key = 'agentQuery') OR EXISTS (SELECT 1 FROM "AgentCandidate");

INSERT INTO "AgentRun" ("id", "agentId", "manual", "status", "message", "startedAt", "finishedAt")
SELECT
  'job-agent-run-' || run.n,
  'job-agent',
  COALESCE((run.entry->>'manual')::boolean, false),
  CASE WHEN run.entry->>'message' IS NULL THEN 'FAILED'::"AgentRunStatus" ELSE 'DONE'::"AgentRunStatus" END,
  run.entry->>'message',
  (run.entry->>'at')::timestamptz,
  (run.entry->>'at')::timestamptz
FROM "Setting" s, jsonb_array_elements(CASE WHEN s.value LIKE '[%' THEN s.value::jsonb ELSE '[]'::jsonb END) WITH ORDINALITY AS run(entry, n)
WHERE s.key = 'agentRuns' AND EXISTS (SELECT 1 FROM "Agent" WHERE "id" = 'job-agent') AND run.entry ? 'at';

UPDATE "AgentCandidate" SET "agentId" = 'job-agent' WHERE EXISTS (SELECT 1 FROM "Agent" WHERE "id" = 'job-agent');

DELETE FROM "Setting" WHERE key LIKE 'agent%';
