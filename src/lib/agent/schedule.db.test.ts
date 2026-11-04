import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { runLimitWarning } from "./runs";
import { nextAgentRun, resetInterruptedDrafts, scheduledRunDue, scheduleText, startDueRuns } from "./schedule";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const zone = vi.hoisted(() => ({ value: "Europe/Berlin" }));
vi.mock("@/lib/time-zone", () => ({ lastKnownTimeZone: async () => zone.value }));
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async () => "agent-job"),
}));

const prisma = () => db.client!;
const run = (at: string) => ({ startedAt: new Date(at) });
const daily = (hour: number) => ({ hour, days: [0, 1, 2, 3, 4, 5, 6] });
const query = { keywords: "Designer", place: "", country: "nl", radiusKm: 25, remoteOnly: false, postedWithin: "any" };

beforeEach(async () => {
  zone.value = "Europe/Berlin";
  await resetDatabase(prisma());
});
afterAll(() => prisma().$disconnect());

describe("when the daily run is due (E16-4)", () => {
  it("reads the hour and the day in the user's time zone, not the server's", () => {
    // 05:30 UTC is 07:30 in Berlin: due at 7 there, though UTC hasn't reached 7.
    expect(scheduledRunDue(new Date("2026-10-20T05:30:00Z"), daily(7), "Europe/Berlin", [])).toBe(true);
    expect(scheduledRunDue(new Date("2026-10-20T04:30:00Z"), daily(7), "Europe/Berlin", [])).toBe(false);
    expect(scheduledRunDue(new Date("2026-10-20T05:30:00Z"), daily(7), "UTC", [])).toBe(false);
    // Kolkata is UTC+5:30, with no daylight saving.
    expect(scheduledRunDue(new Date("2026-10-20T01:30:00Z"), daily(7), "Asia/Kolkata", [])).toBe(true);
    expect(scheduledRunDue(new Date("2026-10-20T01:29:00Z"), daily(7), "Asia/Kolkata", [])).toBe(false);
  });

  it("runs once a day: any run that day in the user's zone, scheduled or not, counts", () => {
    // 23:30 UTC on the 19th is 01:30 on the 20th in Berlin.
    expect(scheduledRunDue(new Date("2026-10-20T06:00:00Z"), daily(7), "Europe/Berlin", [run("2026-10-19T23:30:00Z")])).toBe(false);
    expect(scheduledRunDue(new Date("2026-10-20T06:00:00Z"), daily(7), "UTC", [run("2026-10-19T23:30:00Z")])).toBe(false);
    expect(scheduledRunDue(new Date("2026-10-20T07:00:00Z"), daily(7), "UTC", [run("2026-10-19T23:30:00Z")])).toBe(true);
  });

  it("keeps the hour across daylight saving changes", () => {
    // Berlin leaves summer time on 25 October 2026: 07:00 is 05:00 UTC the day before, 06:00 UTC that day.
    const ranSaturday = [run("2026-10-24T05:00:00Z")];
    expect(nextAgentRun(new Date("2026-10-24T09:00:00Z"), daily(7), "Europe/Berlin", ranSaturday)?.toISOString()).toBe("2026-10-25T06:00:00.000Z");
    // New York leaves it on 1 November 2026.
    const ranOn31st = [run("2026-10-31T11:00:00Z")];
    expect(nextAgentRun(new Date("2026-10-31T15:00:00Z"), daily(7), "America/New_York", ranOn31st)?.toISOString()).toBe("2026-11-01T12:00:00.000Z");
    // And Berlin goes back to summer time on 28 March 2027.
    expect(nextAgentRun(new Date("2027-03-27T10:00:00Z"), daily(7), "Europe/Berlin", [run("2027-03-27T06:00:00Z")])?.toISOString()).toBe("2027-03-28T05:00:00.000Z");
  });

  it("says the next run is today's while it's still to come, and soon when it's overdue", () => {
    expect(nextAgentRun(new Date("2026-10-20T03:00:00Z"), daily(7), "Europe/Berlin", [])?.toISOString()).toBe("2026-10-20T05:00:00.000Z");
    expect(nextAgentRun(new Date("2026-10-20T05:07:00Z"), daily(7), "Europe/Berlin", [])?.toISOString()).toBe("2026-10-20T05:15:00.000Z");
  });
});

describe("weekdays", () => {
  // 20 October 2026 is a Tuesday.
  const weekdays = { hour: 7, days: [1, 2, 3, 4, 5] };

  it("runs only on the chosen days", () => {
    expect(scheduledRunDue(new Date("2026-10-20T06:00:00Z"), weekdays, "UTC", [])).toBe(false);
    expect(scheduledRunDue(new Date("2026-10-20T08:00:00Z"), weekdays, "UTC", [])).toBe(true);
    expect(scheduledRunDue(new Date("2026-10-24T08:00:00Z"), weekdays, "UTC", [])).toBe(false);
    expect(scheduledRunDue(new Date("2026-10-20T08:00:00Z"), { hour: 7, days: [] }, "UTC", [])).toBe(false);
  });

  it("skips to the next chosen day, or says there's none", () => {
    // Friday's run done: Monday next.
    expect(nextAgentRun(new Date("2026-10-23T09:00:00Z"), weekdays, "UTC", [run("2026-10-23T07:00:00Z")])?.toISOString()).toBe("2026-10-26T07:00:00.000Z");
    expect(nextAgentRun(new Date("2026-10-24T09:00:00Z"), weekdays, "UTC", [])?.toISOString()).toBe("2026-10-26T07:00:00.000Z");
    expect(nextAgentRun(new Date("2026-10-24T09:00:00Z"), { hour: 7, days: [] }, "UTC", [])).toBeNull();
  });

  it("says the schedule in words", () => {
    expect(scheduleText(daily(7))).toBe("Daily at 07:00");
    expect(scheduleText(weekdays)).toBe("Weekdays at 07:00");
    expect(scheduleText({ hour: 18, days: [0, 6] })).toBe("Weekends at 18:00");
    expect(scheduleText({ hour: 9, days: [5, 1, 3] })).toBe("Mon, Wed, Fri at 09:00");
    expect(scheduleText({ hour: 9, days: [] })).toBe("No days chosen");
  });
});

describe("the Run now warnings", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const limits = { maxRunsPerDay: 3, manualIntervalMinutes: 60 };

  it("warns within the wait after the previous run", () => {
    expect(runLimitWarning([], limits, now)).toBeNull();
    expect(runLimitWarning([run("2026-10-20T11:35:00Z")], limits, now)).toBe("This agent ran less than an hour ago. Its wait is over in 35 minutes.");
    expect(runLimitWarning([run("2026-10-20T10:59:00Z")], limits, now)).toBeNull();
    expect(runLimitWarning([run("2026-10-20T11:35:00Z")], { ...limits, manualIntervalMinutes: 0 }, now)).toBeNull();
    expect(runLimitWarning([run("2026-10-20T11:50:00Z")], { ...limits, manualIntervalMinutes: 15 }, now)).toBe("This agent ran less than 15 minutes ago. Its wait is over in 5 minutes.");
  });

  it("warns at the agent's own daily limit", () => {
    const three = [run("2026-10-20T10:00:00Z"), run("2026-10-20T08:00:00Z"), run("2026-10-19T13:00:00Z")];
    expect(runLimitWarning(three, limits, now)).toBe("This agent has run 3 times in the past 24 hours, its limit of 3. Another run uses more of your job source's quota.");
    expect(runLimitWarning(three, limits, new Date("2026-10-20T13:00:01Z"))).toBeNull();
    expect(runLimitWarning(three, { ...limits, maxRunsPerDay: 5 }, now)).toBeNull();
  });
});

describe("the schedule (E16-4)", () => {
  it("starts each agent's run when it's due and the agent is on, once", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    const due = new Date("2026-10-20T06:00:00Z");
    const on = await prisma().agent.create({ data: { name: "On", query, enabled: true } });
    // One off, one that only runs on Sundays.
    await prisma().agent.create({ data: { name: "Off", query } });
    await prisma().agent.create({ data: { name: "Sundays", query, enabled: true, days: [0] } });
    expect(await startDueRuns(due)).toEqual(["agent-job"]);
    expect(startJob).toHaveBeenCalledWith(expect.objectContaining({ type: "agent-scan" }), { agentId: on.id, manual: false }, { key: `agent:${on.id}` });
    expect(startJob).toHaveBeenCalledTimes(1);

    // Not while one is queued or running, nor before the hour, nor after today's.
    vi.mocked(startJob).mockClear();
    await prisma().job.create({ data: { type: "agent-scan", key: `agent:${on.id}`, status: "RUNNING", input: { agentId: on.id, manual: false } } });
    expect(await startDueRuns(due)).toEqual([]);
    await prisma().job.deleteMany();
    expect(await startDueRuns(new Date("2026-10-20T04:00:00Z"))).toEqual([]);
    await prisma().agentRun.create({ data: { agentId: on.id, startedAt: new Date("2026-10-20T05:00:00Z") } });
    expect(await startDueRuns(due)).toEqual([]);
    expect(startJob).not.toHaveBeenCalled();
  });

  it("sends drafts a restart interrupted back to the queue, saying so", async () => {
    await prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId: "job-1", dedupeKey: "k1", status: "DRAFTING" } });
    await prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId: "job-2", dedupeKey: "k2", status: "DRAFTED" } });
    expect(await resetInterruptedDrafts()).toBe(1);
    expect(await prisma().agentCandidate.findMany({ orderBy: { externalId: "asc" }, select: { status: true, error: true } })).toEqual([
      { status: "SCORED", error: "Drafting was interrupted. Try again." },
      { status: "DRAFTED", error: null },
    ]);
  });
});
