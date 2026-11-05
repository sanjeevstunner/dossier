import "server-only";

import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { addDays, dayOf, type Day } from "@/lib/calendar-view";
import { zonedTime } from "@/lib/google/slots";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { lastKnownTimeZone } from "@/lib/time-zone";

import { listAgents } from "./agents";
import { agentJobKey, agentScanJob } from "./jobs";
import { failInterruptedRuns } from "./runs";

// The job agents' runs (E16-4): a timer in this process, like the nightly
// backups and the inbox check, so it's only right with one instance. Every
// 15 minutes it starts each agent's run for the day once its hour has come
// on one of its weekdays, in the user's time zone, not the server's.

const EVERY_MS = 15 * 60 * 1000;

type Schedule = { hour: number; days: readonly number[] };
type Runs = readonly { startedAt: Date }[];

/** The moment the run is due on `day`, at `hour` in `timeZone`. */
const dueOn = (day: Day, hour: number, timeZone: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return zonedTime(year, month, date, hour, 0, timeZone);
};

/** 0 = Sunday, for a calendar day. */
const weekdayOf = (day: Day) => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
};

/** Whether a run, of either kind, happened on `now`'s day in `timeZone`. */
const ranToday = (runs: Runs, now: Date, timeZone: string) => runs.some((run) => dayOf(run.startedAt, timeZone) === dayOf(now, timeZone));

/** Whether the day's run should start now: a chosen weekday, the hour has come, and nothing ran today. */
export function scheduledRunDue(now: Date, { hour, days }: Schedule, timeZone: string, runs: Runs): boolean {
  const today = dayOf(now, timeZone);
  return days.includes(weekdayOf(today)) && now >= dueOn(today, hour, timeZone) && !ranToday(runs, now, timeZone);
}

/** When the next scheduled run starts, or null with no weekday chosen. */
export function nextAgentRun(now: Date, { hour, days }: Schedule, timeZone: string, runs: Runs): Date | null {
  const today = dayOf(now, timeZone);
  if (days.includes(weekdayOf(today)) && !ranToday(runs, now, timeZone)) {
    const due = dueOn(today, hour, timeZone);
    // Overdue: the next check starts it.
    return due > now ? due : new Date(Math.ceil(now.getTime() / EVERY_MS) * EVERY_MS);
  }
  for (let ahead = 1; ahead <= 7; ahead++) {
    const day = addDays(today, ahead);
    if (days.includes(weekdayOf(day))) return dueOn(day, hour, timeZone);
  }
  return null;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Daily at 07:00", "Weekdays at 07:00", "Mon, Wed, Fri at 07:00". */
export function scheduleText({ hour, days }: Schedule): string {
  const at = `at ${String(hour).padStart(2, "0")}:00`;
  const set = new Set(days);
  if (set.size === 0) return "No days chosen";
  if (set.size === 7) return `Daily ${at}`;
  if (set.size === 5 && [1, 2, 3, 4, 5].every((day) => set.has(day))) return `Weekdays ${at}`;
  if (set.size === 2 && set.has(0) && set.has(6)) return `Weekends ${at}`;
  // Monday first.
  return `${[1, 2, 3, 4, 5, 6, 0].filter((day) => set.has(day)).map((day) => DAY_NAMES[day]).join(", ")} ${at}`;
}

/** Starts each enabled agent's run when it's due and none is queued or running. Returns the jobs started. */
export async function startDueRuns(now = new Date()): Promise<string[]> {
  const timeZone = await lastKnownTimeZone();
  const started: string[] = [];
  for (const agent of await listAgents()) {
    if (!agent.enabled) continue;
    const runs = await prisma.agentRun.findMany({ where: { agentId: agent.id }, orderBy: { startedAt: "desc" }, take: 5, select: { startedAt: true } });
    if (!scheduledRunDue(now, agent, timeZone, runs)) continue;
    if ((await findUnfinishedJobs(agentJobKey(agent.id))).length > 0) continue;
    started.push(await startJob(agentScanJob, { agentId: agent.id, manual: false }, { key: agentJobKey(agent.id) }));
  }
  return started;
}

/** After a restart, a candidate left DRAFTING has no job to finish it. */
export async function resetInterruptedDrafts(): Promise<number> {
  const { count } = await prisma.agentCandidate.updateMany({
    where: { status: AgentCandidateStatus.DRAFTING },
    data: { status: AgentCandidateStatus.SCORED, error: "Drafting was interrupted. Try again." },
  });
  return count;
}

const globalForAgent = globalThis as unknown as { agentTimer?: ReturnType<typeof setInterval> };

/** Starts the timer, once per process (dev reloads keep the one they have). */
export function startAgentSchedule(): void {
  if (globalForAgent.agentTimer) return;
  void Promise.all([resetInterruptedDrafts(), failInterruptedRuns()]).catch((error: unknown) => logServerError("job agent", error));
  const check = () => void startDueRuns().catch((error: unknown) => logServerError("job agent schedule", error));
  globalForAgent.agentTimer = setInterval(check, EVERY_MS);
  // Don't keep the process alive just for this.
  globalForAgent.agentTimer.unref?.();
  check();
}
