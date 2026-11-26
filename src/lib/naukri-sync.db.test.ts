import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { DEFAULT_NAUKRI_STATUS_MAP } from "./naukri-status";
import { loadConflicts, resolveConflict } from "./naukri-conflicts";
import { applyNaukriApplications } from "./naukri-sync";
import { applyStatusChange } from "./status-changes";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/job-search/config", () => ({}));
vi.mock("@/lib/job-search/naukri", () => ({}));
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => ({ naukriStatusMap: DEFAULT_NAUKRI_STATUS_MAP }), saveSettings: vi.fn() }));
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
    expect(await applyNaukriApplications(list)).toEqual({ created: 2, updated: 0, total: 2, unmapped: [], conflicts: 0 });
    expect(await applyNaukriApplications(list)).toEqual({ created: 0, updated: 0, total: 2, unmapped: [], conflicts: 0 });
    const rows = await prisma().application.findMany({ orderBy: { externalId: "asc" } });
    expect(rows.map((row) => [row.syncedFrom, row.externalId, row.status, row.company])).toEqual([
      ["NAUKRI", "1", "SENT", "Acme"],
      ["NAUKRI", "2", "SCREENING", "Acme"],
    ]);
    expect(rows[0]!.sentAt).toEqual(new Date(Date.UTC(2026, 10, 1)));
    // The Notes tab's history keeps Naukri's own word beside the status.
    const events = await prisma().statusEvent.findMany({ orderBy: { applicationId: "asc" }, select: { to: true, naukriStatus: true, applicationId: true } });
    expect(events.map((event) => [event.to, event.naukriStatus]).sort()).toEqual([["SCREENING", "Viewed"], ["SENT", "Applied"]]);
  });

  it("takes Naukri's newer status for synced applications", async () => {
    await applyNaukriApplications([found("1", "Applied")]);
    expect(await applyNaukriApplications([found("1", "Applied", "Not Shortlisted")])).toMatchObject({ created: 0, updated: 1 });
    expect((await prisma().application.findFirstOrThrow()).status).toBe("REJECTED");
    expect((await prisma().statusEvent.findMany({ orderBy: { at: "desc" }, take: 1 }))[0]).toMatchObject({ to: "REJECTED", naukriStatus: "Not Shortlisted" });
  });

  it("leaves an application Dossier sent itself as it is and lists it for review, matched by job id", async () => {
    const own = await prisma().application.create({ data: { company: "Acme", status: "SENT", furthestStage: "SENT", sentAt: new Date() } });
    await prisma().posting.create({
      data: { source: "NAUKRI", externalId: "9", title: "T", company: "Acme", application: { connect: { id: own.id } } },
    });
    expect(await applyNaukriApplications([found("9", "Applied", "Shortlisted")])).toEqual({ created: 0, updated: 0, total: 1, unmapped: [], conflicts: 1 });
    expect(await prisma().application.count()).toBe(1);
    expect(await prisma().application.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({ status: "SENT", syncedFrom: null, naukriWord: "Shortlisted" });
    expect(await loadConflicts(DEFAULT_NAUKRI_STATUS_MAP)).toMatchObject([{ id: own.id, status: "SENT", word: "Shortlisted", naukriStatus: "SCREENING" }]);
  });

  it("adds Naukri's word to a move that was already made without it", async () => {
    await applyNaukriApplications([found("1", "Applied", "Viewed")]);
    await prisma().statusEvent.updateMany({ data: { naukriStatus: null } });
    await applyNaukriApplications([found("1", "Applied", "Viewed")]);
    expect((await prisma().statusEvent.findMany({ where: { to: "SCREENING" } }))[0]).toMatchObject({ naukriStatus: "Viewed" });
  });

  it("asks about an application you moved by hand, once per Naukri word", async () => {
    await applyNaukriApplications([found("1", "Applied")]);
    const row = await prisma().application.findFirstOrThrow();
    await applyStatusChange(prisma(), row.id, "INTERVIEW");
    expect(await applyNaukriApplications([found("1", "Applied")])).toMatchObject({ updated: 0, conflicts: 1 });
    expect((await prisma().application.findFirstOrThrow()).status).toBe("INTERVIEW");

    // Keeping it settles that word, however often the sync runs.
    await resolveConflict(row.id, "dossier", DEFAULT_NAUKRI_STATUS_MAP);
    expect(await applyNaukriApplications([found("1", "Applied")])).toMatchObject({ conflicts: 0 });
    // A different word that still disagrees asks again.
    expect(await applyNaukriApplications([found("1", "Applied", "Viewed")])).toMatchObject({ conflicts: 1 });
    // A word that maps to where the application already is doesn't.
    await prisma().application.update({ where: { id: row.id }, data: { status: "SCREENING" } });
    expect(await applyNaukriApplications([found("1", "Applied", "Shortlisted")])).toMatchObject({ conflicts: 0 });
  });

  it("takes Naukri's status when you choose it, and follows Naukri after that", async () => {
    await applyNaukriApplications([found("1", "Applied")]);
    const row = await prisma().application.findFirstOrThrow();
    await applyStatusChange(prisma(), row.id, "INTERVIEW");
    await applyNaukriApplications([found("1", "Applied", "Not Shortlisted")]);
    await resolveConflict(row.id, "naukri", DEFAULT_NAUKRI_STATUS_MAP);
    expect(await prisma().application.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "REJECTED", naukriResolvedWord: "Not Shortlisted" });
    expect((await prisma().statusEvent.findMany({ orderBy: { at: "desc" }, take: 1 }))[0]).toMatchObject({ to: "REJECTED", naukriStatus: "Not Shortlisted" });
    // Naukri moved it last, so the next change applies without asking.
    expect(await applyNaukriApplications([found("1", "Applied", "Not Shortlisted", "Interview")])).toMatchObject({ updated: 1, conflicts: 0 });
  });

  it("uses the configured words, and reports the ones nobody listed, creating those as sent", async () => {
    const map = { ...DEFAULT_NAUKRI_STATUS_MAP, SCREENING: ["Under Review"] };
    const result = await applyNaukriApplications([found("1", "Applied", "Under Review"), found("2", "Profile Boosted")], new Date(), map);
    expect(result).toMatchObject({ created: 2, unmapped: ["Profile Boosted"] });
    const rows = await prisma().application.findMany({ orderBy: { externalId: "asc" } });
    expect(rows.map((row) => row.status)).toEqual(["SCREENING", "SENT"]);
  });
});
