import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { DEFAULT_NAUKRI_STATUS_MAP } from "./naukri-status";
import { applyNaukriApplications } from "./naukri-sync";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/job-search/config", () => ({}));
vi.mock("@/lib/job-search/naukri", () => ({}));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));

const prisma = () => db.client!;
const found = (jobId: string, ...words: string[]) => ({
  jobId,
  title: `Role ${jobId}`,
  company: "Acme",
  location: "Pune",
  statuses: words.map((value, index) => ({ value, at: new Date(Date.UTC(2026, 10, 1 + index)) })),
});

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("syncing Naukri applications", () => {
  it("creates synced applications once, however often it runs", async () => {
    const list = [found("1", "Applied"), found("2", "Applied", "Viewed")];
    expect(await applyNaukriApplications(list)).toEqual({ created: 2, updated: 0, total: 2, unmapped: [] });
    expect(await applyNaukriApplications(list)).toEqual({ created: 0, updated: 0, total: 2, unmapped: [] });
    const rows = await prisma().application.findMany({ orderBy: { externalId: "asc" } });
    expect(rows.map((row) => [row.syncedFrom, row.externalId, row.status, row.company])).toEqual([
      ["NAUKRI", "1", "SENT", "Acme"],
      ["NAUKRI", "2", "SCREENING", "Acme"],
    ]);
    expect(rows[0]!.sentAt).toEqual(new Date(Date.UTC(2026, 10, 1)));
  });

  it("takes Naukri's newer status for synced applications", async () => {
    await applyNaukriApplications([found("1", "Applied")]);
    expect(await applyNaukriApplications([found("1", "Applied", "Not Shortlisted")])).toMatchObject({ created: 0, updated: 1 });
    expect((await prisma().application.findFirstOrThrow()).status).toBe("REJECTED");
  });

  it("updates an application Dossier sent itself, matched by job id, without a second one or its badge", async () => {
    const own = await prisma().application.create({ data: { company: "Acme", status: "SENT", furthestStage: "SENT", sentAt: new Date() } });
    await prisma().posting.create({
      data: { source: "NAUKRI", externalId: "9", title: "T", company: "Acme", application: { connect: { id: own.id } } },
    });
    expect(await applyNaukriApplications([found("9", "Applied", "Shortlisted")])).toEqual({ created: 0, updated: 1, total: 1, unmapped: [] });
    expect(await prisma().application.count()).toBe(1);
    expect(await prisma().application.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({ status: "SCREENING", syncedFrom: null });
  });

  it("doesn't pull an application moved on by hand back to sent", async () => {
    await applyNaukriApplications([found("1", "Applied")]);
    const row = await prisma().application.findFirstOrThrow();
    await prisma().application.update({ where: { id: row.id }, data: { status: "INTERVIEW" } });
    expect(await applyNaukriApplications([found("1", "Applied")])).toMatchObject({ updated: 0 });
    expect((await prisma().application.findFirstOrThrow()).status).toBe("INTERVIEW");
  });

  it("uses the configured words, and reports the ones nobody listed, creating those as sent", async () => {
    const map = { ...DEFAULT_NAUKRI_STATUS_MAP, SCREENING: ["Under Review"] };
    const result = await applyNaukriApplications([found("1", "Applied", "Under Review"), found("2", "Profile Boosted")], new Date(), map);
    expect(result).toMatchObject({ created: 2, unmapped: ["Profile Boosted"] });
    const rows = await prisma().application.findMany({ orderBy: { externalId: "asc" } });
    expect(rows.map((row) => row.status)).toEqual(["SCREENING", "SENT"]);
  });
});
