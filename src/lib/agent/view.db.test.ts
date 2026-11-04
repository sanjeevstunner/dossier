import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { countAgentQueue, loadAgentDetail, loadAgentList } from "./view";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/time-zone", () => ({ lastKnownTimeZone: async () => "Europe/Berlin" }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({ source: "JSEARCH", saved: true, jsearch: { key: "k", host: "openwebninja", keyState: "set" }, adzuna: { appId: "", key: null, keyState: "none" } }),
  credentialsFor: () => ({ key: "k", host: "openwebninja" }),
}));

const prisma = () => db.client!;
const now = new Date("2026-10-20T10:00:00Z");
const query = { keywords: "Data scientist", place: "Berlin", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" };
let agentId = "";
const candidate = (externalId: string, score: number, data: Record<string, unknown> = {}) =>
  prisma().agentCandidate.create({ data: { agentId, source: "JSEARCH", externalId, dedupeKey: externalId, title: `Posting ${externalId}`, company: "Ledgerly", place: "Berlin", remote: true, score, via: "LinkedIn", postedAt: new Date("2026-10-18T00:00:00Z"), ...data } });

beforeEach(async () => {
  await resetDatabase(prisma());
  agentId = (await prisma().agent.create({ data: { name: "Data", enabled: true, query } })).id;
  await prisma().agentRun.create({
    data: { agentId, status: "DONE", startedAt: new Date("2026-10-20T05:00:00Z"), message: "2 new postings are waiting for a look.", found: 4, steps: [{ at: "2026-10-20T05:00:01Z", text: "Searching for new postings" }] },
  });
});
afterAll(() => prisma().$disconnect());

describe("an agent's screen (E16-6)", () => {
  it("splits the queue into drafts, scored postings and those below the minimum, best first", async () => {
    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    await candidate("draft", 90, { status: "DRAFTED", applicationId: application.id });
    const good = await candidate("good", 75);
    await candidate("better", 88);
    await candidate("low", 30);
    await candidate("gone", 95, { status: "DISMISSED" });
    await candidate("kept", 95, { status: "APPROVED" });
    // Another agent's.
    const other = await prisma().agent.create({ data: { name: "Other", query } });
    await prisma().agentCandidate.create({ data: { agentId: other.id, source: "JSEARCH", externalId: "theirs", dedupeKey: "theirs", score: 99 } });
    const job = await prisma().job.create({ data: { type: "agent-draft", key: `agent-candidate:${good.id}`, input: { candidateId: good.id } } });

    const view = (await loadAgentDetail(agentId, undefined, now))!;
    expect(view.drafts.map((entry) => entry.title)).toEqual(["Posting draft"]);
    expect(view.scored.map((entry) => entry.title)).toEqual(["Posting better", "Posting good"]);
    expect(view.belowMinimum.map((entry) => entry.title)).toEqual(["Posting low"]);
    expect(view.scored[1]).toMatchObject({ facts: "Berlin · Remote", origin: "Posted 2 days ago · via LinkedIn on JSearch", draftJobId: job.id });
    expect(view).toMatchObject({
      search: "Data scientist · Berlin, 25 km · via JSearch",
      schedule: "Daily at 07:00",
      setupProblem: null,
      limitWarning: null,
      nextRun: "Wed 21 Oct, 07:00",
      runs: [{ at: "Tue 20 Oct, 07:00", status: "DONE", manual: false, message: "2 new postings are waiting for a look." }],
      run: { counts: { found: 4 }, steps: [{ at: "Tue 20 Oct, 07:00", text: "Searching for new postings" }] },
      agents: [{ name: "Data" }, { name: "Other" }],
    });
    // The badge: scored at or above each agent's minimum, and drafts.
    expect(await countAgentQueue()).toBe(4);
    expect(await loadAgentDetail("gone")).toBeNull();
  });

  it("says what's missing, and warns when Run now would be past its limits", async () => {
    await prisma().agent.update({ where: { id: agentId }, data: { enabled: false, query: { ...query, keywords: "" } } });
    for (const time of ["09:30", "08:00"]) await prisma().agentRun.create({ data: { agentId, startedAt: new Date(`2026-10-20T${time}:00Z`) } });
    expect(await loadAgentDetail(agentId, undefined, now)).toMatchObject({
      search: null,
      setupProblem: "Add what this agent should look for first.",
      setupSection: null,
      limitWarning: "This agent has run 3 times in the past 24 hours, its limit of 3. Another run uses more of your job source's quota.",
      nextRun: null,
    });
  });

  it("opens the run picked in History, with what it scored", async () => {
    const run = await prisma().agentRun.create({ data: { agentId, startedAt: new Date("2026-10-19T05:00:00Z"), status: "FAILED" } });
    await candidate("found", 80, { runId: run.id });
    await candidate("missed", 20, { runId: run.id });
    const view = (await loadAgentDetail(agentId, run.id, now))!;
    expect(view.run).toMatchObject({
      id: run.id,
      status: "FAILED",
      postings: [
        { title: "Posting found", score: 80, state: "Waiting" },
        { title: "Posting missed", score: 20, state: "Below minimum" },
      ],
    });
  });
});

describe("the Agents screen (E16-6)", () => {
  it("lists each agent with its schedule, last run and what's waiting", async () => {
    await candidate("good", 75);
    await prisma().agent.create({ data: { name: "Weekends", query: { ...query, keywords: "" }, days: [0, 6], hour: 18 } });
    expect(await loadAgentList(now)).toMatchObject([
      { name: "Data", enabled: true, schedule: "Daily at 07:00", waiting: 1, lastRun: { status: "DONE" }, nextRun: "Wed 21 Oct, 07:00", setupProblem: null },
      { name: "Weekends", enabled: false, schedule: "Weekends at 18:00", waiting: 0, lastRun: null, nextRun: null, setupProblem: "Add what this agent should look for first." },
    ]);
  });
});
