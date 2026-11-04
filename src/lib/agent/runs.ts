import "server-only";

import { AgentRunStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

// The job agents' runs (E16), with their logs. Their own rows rather than
// Job rows, which the task-data sweep deletes after "Keep task data for".

const DAY_MS = 24 * 60 * 60 * 1000;

type Limits = { maxRunsPerDay: number; manualIntervalMinutes: number };

/** The runs in the 24 hours before `now`, of those given newest first. */
export const runsInPastDay = <T extends { startedAt: Date }>(runs: readonly T[], now: Date) =>
  runs.filter((run) => now.getTime() - run.startedAt.getTime() < DAY_MS);

/**
 * Why Run now might be too soon, in words, or null. Only ever a warning:
 * Run anyway goes ahead. The limits are the agent's own.
 */
export function runLimitWarning(runs: readonly { startedAt: Date }[], limits: Limits, now: Date): string | null {
  const recent = runsInPastDay(runs, now);
  if (recent.length >= limits.maxRunsPerDay) {
    return `This agent has run ${recent.length} ${recent.length === 1 ? "time" : "times"} in the past 24 hours, its limit of ${limits.maxRunsPerDay}. Another run uses more of your job source's quota.`;
  }
  const last = runs[0];
  if (last && limits.manualIntervalMinutes > 0) {
    const wait = last.startedAt.getTime() + limits.manualIntervalMinutes * 60_000 - now.getTime();
    if (wait > 0) return `This agent ran less than ${minutesText(limits.manualIntervalMinutes)} ago. ${waitText(wait)}`;
  }
  return null;
}

const minutesText = (minutes: number) =>
  minutes % 60 === 0 ? (minutes === 60 ? "an hour" : `${minutes / 60} hours`) : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;

/** "Its wait is over in 25 minutes." */
function waitText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `Its wait is over in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  const hours = Math.ceil(minutes / 60);
  return `Its wait is over in ${hours} ${hours === 1 ? "hour" : "hours"}.`;
}

/** Records a run as it starts, before it asks the source, so the schedule sees it even if it crashes. */
export async function recordRunStart(agentId: string, manual: boolean, now = new Date()): Promise<string> {
  // ponytail: runs are kept for good; trim to the latest N per agent if the table grows.
  const run = await prisma.agentRun.create({ data: { agentId, manual, startedAt: now }, select: { id: true } });
  return run.id;
}

/** Adds a line to the run's log. */
export async function logStep(runId: string, text: string): Promise<void> {
  const entry = JSON.stringify([{ at: new Date().toISOString(), text }]);
  await prisma.$executeRaw`UPDATE "AgentRun" SET steps = steps || ${entry}::jsonb WHERE id = ${runId}`;
}

export type RunCounts = { found: number; fresh: number; scored: number; drafted: number; skipped: number };

/** What a run ended with. */
export async function recordRunEnd(runId: string, outcome: RunCounts & { message: string; failed: boolean }): Promise<void> {
  const { failed, ...data } = outcome;
  await logStep(runId, outcome.message);
  await prisma.agentRun.updateMany({
    where: { id: runId },
    data: { ...data, status: failed ? AgentRunStatus.FAILED : AgentRunStatus.DONE, finishedAt: new Date() },
  });
}

/** A run left RUNNING by a restart has no job to finish it. */
export async function failInterruptedRuns(): Promise<number> {
  const { count } = await prisma.agentRun.updateMany({
    where: { status: AgentRunStatus.RUNNING },
    data: { status: AgentRunStatus.FAILED, message: "The run was interrupted.", finishedAt: new Date() },
  });
  return count;
}
