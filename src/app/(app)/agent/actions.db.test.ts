import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchQuery } from "@/lib/job-search/search";
import { setStatus } from "@/lib/status-actions";
import { createTestClient, resetDatabase } from "@/test/db";

import { approveAgentDraft, createAgent, deleteAgent, dismissAgentCandidate, prepareAgentDraft, restoreAgentCandidate, runAgentNow, saveAgent } from "./actions";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async () => "new-run"),
}));
const setup = vi.hoisted(() => ({ ai: true, source: "JSEARCH" as "JSEARCH" | null }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => setup.ai }));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({ source: setup.source, saved: true, jsearch: { key: "k", host: "openwebninja", keyState: "set" }, adzuna: { appId: "", key: null, keyState: "none" } }),
  credentialsFor: () => ({ key: "k", host: "openwebninja" }),
  requestContext: () => ({}),
}));
vi.mock("@/lib/posting-searches", () => ({ loadSearch: async () => null }));

const prisma = () => db.client!;
const candidate = (data: { status?: "SCORED" | "DRAFTED" | "DRAFTING"; applicationId?: string } = {}) =>
  prisma().agentCandidate.create({
    data: { source: "JSEARCH", externalId: `job-${Math.random()}`, dedupeKey: `key-${Math.random()}`, title: "Data Scientist", company: "Ledgerly", url: "https://jobs.example/1", score: 88, reasons: ["Python"], ...data },
  });
const query: SearchQuery = { keywords: "Data scientist", place: "", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" };

let id = "";
const runAt = (minutesAgo: number) => prisma().agentRun.create({ data: { agentId: id, startedAt: new Date(Date.now() - minutesAgo * 60_000) } });

beforeEach(async () => {
  Object.assign(setup, { ai: true, source: "JSEARCH" });
  await resetDatabase(prisma());
  id = (await prisma().agent.create({ data: { name: "Data", enabled: true, query } })).id;
});
afterAll(() => prisma().$disconnect());

describe("Run now (E16-4)", () => {
  it("starts a run, keyed so the schedule and the screen find it", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    expect(await runAgentNow({ id })).toEqual({ ok: true, data: { jobId: "new-run", warning: null } });
    expect(startJob).toHaveBeenLastCalledWith(expect.objectContaining({ type: "agent-scan" }), { agentId: id, manual: true }, { key: `agent:${id}` });
  });

  it("reuses a run that's queued or running", async () => {
    const running = await prisma().job.create({ data: { type: "agent-scan", key: `agent:${id}`, status: "RUNNING", input: { agentId: id, manual: false } } });
    expect(await runAgentNow({ id })).toEqual({ ok: true, data: { jobId: running.id, warning: null } });
  });

  it("says what's missing before it starts, and runs while it's off", async () => {
    await prisma().agent.update({ where: { id }, data: { enabled: false } });
    expect(await runAgentNow({ id })).toMatchObject({ ok: true, data: { jobId: "new-run" } });
    await prisma().agent.update({ where: { id }, data: { query: { ...query, keywords: "" } } });
    expect(await runAgentNow({ id })).toMatchObject({ ok: false, error: "Add what this agent should look for first." });
    await prisma().agent.update({ where: { id }, data: { query } });
    setup.ai = false;
    expect(await runAgentNow({ id })).toMatchObject({ ok: false, error: "Choose an AI provider in Settings → AI provider first." });
    setup.ai = true;
    setup.source = null;
    expect(await runAgentNow({ id })).toMatchObject({ ok: false, error: "Choose a job source in Settings → Job search first." });
    expect(await runAgentNow({ id: "gone" })).toEqual({ ok: false, error: "That agent no longer exists." });
  });

  it("warns past the agent's limits, and Run anyway goes ahead", async () => {
    await runAt(20);
    expect(await runAgentNow({ id })).toEqual({ ok: true, data: { jobId: null, warning: "This agent ran less than an hour ago. Its wait is over in 40 minutes." } });
    await prisma().agentRun.deleteMany();
    for (const minutes of [70, 200, 400]) await runAt(minutes);
    expect(await runAgentNow({ id })).toMatchObject({ ok: true, data: { jobId: null, warning: expect.stringMatching(/^This agent has run 3 times in the past 24 hours/) } });
    expect(await runAgentNow({ id, force: true })).toEqual({ ok: true, data: { jobId: "new-run", warning: null } });
    // Its own limits.
    await prisma().agent.update({ where: { id }, data: { maxRunsPerDay: 5 } });
    expect(await runAgentNow({ id })).toEqual({ ok: true, data: { jobId: "new-run", warning: null } });
  });
});

describe("the drafts' actions (E16-5)", () => {
  it("prepares a draft in its own job, reuses one under way, and answers with one already made", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    const scored = await candidate();
    expect(await prepareAgentDraft({ candidateId: scored.id })).toEqual({ ok: true, data: { jobId: "new-run", applicationId: null } });
    expect(startJob).toHaveBeenLastCalledWith(expect.objectContaining({ type: "agent-draft" }), { candidateId: scored.id }, { key: `agent-candidate:${scored.id}` });

    const queued = await prisma().job.create({ data: { type: "agent-draft", key: `agent-candidate:${scored.id}`, input: { candidateId: scored.id } } });
    expect(await prepareAgentDraft({ candidateId: scored.id })).toEqual({ ok: true, data: { jobId: queued.id, applicationId: null } });

    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    const drafted = await candidate({ status: "DRAFTED", applicationId: application.id });
    expect(await prepareAgentDraft({ candidateId: drafted.id })).toEqual({ ok: true, data: { jobId: null, applicationId: application.id } });
    expect(await prepareAgentDraft({ candidateId: "gone" })).toEqual({ ok: false, error: "That posting is no longer in the agent's queue." });
  });

  it("approves a draft into Applications, saying nothing was sent", async () => {
    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    const drafted = await candidate({ status: "DRAFTED", applicationId: application.id });
    expect(await approveAgentDraft({ candidateId: drafted.id })).toEqual({
      ok: true,
      data: { applicationId: application.id },
      toast: "Added to Applications as a draft. Nothing has been sent.",
    });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: application.id } })).toMatchObject({ awaitingReview: false });
  });

  it("dismisses a posting, with what Undo needs, and puts it back", async () => {
    const scored = await candidate();
    const result = await dismissAgentCandidate({ candidateId: scored.id });
    expect(result).toMatchObject({ ok: true, data: { undo: { id: scored.id, url: "https://jobs.example/1", reasons: ["Python"] } } });
    if (!result.ok || !result.data.undo) throw new Error("no undo");
    // As the browser sends it back: dates as strings, and a link that must stay a web address.
    const sent = JSON.parse(JSON.stringify(result.data.undo));
    expect(await restoreAgentCandidate({ ...sent, url: "javascript:alert(1)" })).toEqual({ ok: true, data: null });
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: scored.id } })).toMatchObject({ status: "SCORED", url: "", reasons: ["Python"] });
  });

  it("approves a draft waiting for review when its status moves on (#195)", async () => {
    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    const drafted = await candidate({ status: "DRAFTED", applicationId: application.id });
    expect(await setStatus({ id: application.id, to: "SENT" })).toMatchObject({ ok: true });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: application.id } })).toMatchObject({ status: "SENT", awaitingReview: false });
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: drafted.id } })).toMatchObject({ status: "APPROVED" });
  });
});

describe("the agents themselves (E16-7)", () => {
  it("makes a new one, off, with the defaults", async () => {
    const result = await createAgent({});
    if (!result.ok) throw new Error(result.error);
    expect(await prisma().agent.findUniqueOrThrow({ where: { id: result.data.id } })).toMatchObject({
      name: "Job agent 2",
      enabled: false,
      hour: 7,
      days: [0, 1, 2, 3, 4, 5, 6],
      minScore: 70,
      maxRunsPerDay: 3,
      manualIntervalMinutes: 60,
      query: { keywords: "" },
    });
  });

  it("saves each change, and turns on only with keywords and a country", async () => {
    await prisma().agent.update({ where: { id }, data: { enabled: false, query: { ...query, keywords: "" } } });
    expect(await saveAgent({ id, enabled: true })).toEqual({ ok: false, error: "Type what the agent should look for before turning it on." });
    expect(await saveAgent({ id, enabled: true, query: { ...query, country: "" } })).toEqual({ ok: false, error: "Choose a country for the search before turning the agent on." });
    expect(await saveAgent({ id, enabled: true, query })).toEqual({ ok: true, data: null });
    expect(await saveAgent({ id, name: "Berlin data", hour: 9, days: [5, 1, 1], minScore: 80, autoDraft: true, maxDrafts: 5, maxRunsPerDay: 6, manualIntervalMinutes: 15 })).toEqual({ ok: true, data: null });
    expect(await prisma().agent.findUniqueOrThrow({ where: { id } })).toMatchObject({
      name: "Berlin data",
      enabled: true,
      query,
      hour: 9,
      days: [1, 5],
      minScore: 80,
      autoDraft: true,
      maxDrafts: 5,
      maxScores: 15,
      maxRunsPerDay: 6,
      manualIntervalMinutes: 15,
    });
    expect(await saveAgent({ id, maxScores: 31 })).toMatchObject({ ok: false });
    expect(await saveAgent({ id, name: "  " })).toMatchObject({ ok: false });
    expect(await saveAgent({ id: "gone", hour: 3 })).toEqual({ ok: false, error: "That agent no longer exists." });
  });

  it("deletes one with its runs, keeping what it found", async () => {
    await runAt(10);
    const found = await candidate();
    await prisma().agentCandidate.update({ where: { id: found.id }, data: { agentId: id } });
    expect(await deleteAgent({ id })).toMatchObject({ ok: true });
    expect(await prisma().agent.count()).toBe(0);
    expect(await prisma().agentRun.count()).toBe(0);
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: found.id } })).toMatchObject({ agentId: null });
  });
});
