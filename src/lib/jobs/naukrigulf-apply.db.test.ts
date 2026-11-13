import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { NaukriGulfApplied } from "@/lib/job-search/naukrigulf";
import type { FoundPosting } from "@/lib/job-search/search";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../prisma/seed/built-ins";

import { naukriGulfApplyJob } from "./naukrigulf-apply";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile(), loadProfileName: async () => "Jane Doe", loadFactTexts: async () => [] };
});
// Dossier's own model drafts the application; here it's done.
vi.mock("./read-posting", () => ({
  readPostingJob: {
    run: async () => ({
      extracted: { title: null, company: "Acme Gulf", role: "DevOps Engineer", location: "Dubai", mode: null, salary: null, deadline: null, requirements: [], asksForReferences: false, language: "English" },
      extractedWith: "extract-posting@1",
      match: { items: [] },
      matchedWith: "match-requirements@1",
    }),
  },
}));
vi.mock("./write-documents", async () => {
  const { demoLetterUnits, demoResumeUnits } = await import("@/lib/demo-profile");
  return {
    writeDocumentsJob: {
      run: async () => ({ resume: demoResumeUnits(), resumeWith: "tailor-resume@10", letter: demoLetterUnits(), letterWith: "write-cover-letter@6" }),
    },
  };
});
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({}),
  credentialsFor: () => ({ url: "http://noperi", apiKey: "k" }),
  requestContext: () => ({}),
}));
vi.mock("@/lib/job-search/find", () => ({ fullText: async () => "The whole posting." }));

const fake = vi.hoisted(() => ({
  answer: { applied: true, alreadyApplied: false, companySite: false, needsMore: false, status: 200, message: null } as NaukriGulfApplied,
  applies: [] as string[],
  inHistory: false,
  quota: false,
}));
vi.mock("@/lib/job-search/naukrigulf", () => ({
  naukriGulfApply: async (_c: unknown, jobId: string) => {
    if (fake.quota) throw (await import("@/lib/job-search/errors")).jobSearchError("quota", "NAUKRIGULF", { detail: "apply: HTTP 429" });
    fake.applies.push(jobId);
    return fake.answer;
  },
  naukriGulfHasApplied: async () => fake.inHistory,
}));
vi.mock("@/lib/log", () => ({ logServerError: () => {} }));

const prisma = () => db.client!;
const posting: FoundPosting = {
  source: "NAUKRIGULF",
  externalId: "41126502315",
  title: "DevOps Engineer",
  company: "Acme Gulf",
  place: "Dubai",
  remote: null,
  salary: "",
  postedAt: null,
  url: "https://www.naukrigulf.com/devops-engineer-jobs-in-dubai-uae-41126502315",
  via: "",
  description: "The start…",
  complete: false,
};
const answer = (change: Partial<NaukriGulfApplied>): NaukriGulfApplied => ({ applied: false, alreadyApplied: false, companySite: false, needsMore: false, status: 200, message: null, ...change });
const context = () => {
  const steps: string[] = [];
  return { id: "naukrigulf-apply-job", steps, step: async (name: string) => void steps.push(name), signal: new AbortController().signal };
};
const statusOf = async (applicationId: string) => (await prisma().application.findUniqueOrThrow({ where: { id: applicationId } })).status;

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  Object.assign(fake, { answer: answer({ applied: true }), applies: [], inHistory: false, quota: false });
});
afterAll(() => prisma().$disconnect());

describe("NaukriGulf easy apply agent", () => {
  it("drafts the application, applies, and puts the confirmed application in Sent", async () => {
    const run = context();
    const result = await naukriGulfApplyJob.run({ posting }, run);

    expect(run.steps).toEqual(["Adding it to your board", "Applying on NaukriGulf with your profile's resume", "Moving it to Sent"]);
    expect(fake.applies).toEqual(["41126502315"]);
    expect(result).toMatchObject({ answered: [], missing: [] });
    const application = await prisma().application.findUniqueOrThrow({ where: { id: result.applicationId }, include: { posting: true } });
    expect(application).toMatchObject({ status: "SENT", company: "Acme Gulf", role: "DevOps Engineer" });
    expect(application.posting).toMatchObject({ source: "NAUKRIGULF", externalId: "41126502315" });
    expect((await prisma().note.findMany({ where: { applicationId: result.applicationId } })).map((note) => note.body)).toEqual([
      "Applied on NaukriGulf easy apply, with the resume on the NaukriGulf profile.",
    ]);

    // Run again (Retry): still one card.
    fake.answer = answer({ applied: true, alreadyApplied: true });
    await naukriGulfApplyJob.run({ posting }, context());
    expect(await prisma().application.count()).toBe(1);
  });

  it("keeps a draft, with NaukriGulf's words, when it wants more or applies on the company site", async () => {
    fake.answer = answer({ needsMore: true, status: 400, message: "Answer the employer's questions" });
    await expect(naukriGulfApplyJob.run({ posting }, context())).rejects.toThrow(
      "NaukriGulf wants more before this apply: “Answer the employer's questions”. Finish it on naukrigulf.com; it stays a draft on your board.",
    );
    const [draft] = await prisma().application.findMany();
    expect(draft.status).toBe("DRAFT");

    fake.answer = answer({ companySite: true });
    await expect(naukriGulfApplyJob.run({ posting }, context())).rejects.toThrow(/applies on the company site/);
    expect(await statusOf(draft.id)).toBe("DRAFT");
  });

  it("checks the history when the apply isn't confirmed", async () => {
    fake.answer = answer({ status: 500, message: "Try later" });
    await expect(naukriGulfApplyJob.run({ posting }, context())).rejects.toThrow("NaukriGulf didn't confirm the application: “Try later” It stays a draft on your board.");

    fake.inHistory = true;
    const run = context();
    const result = await naukriGulfApplyJob.run({ posting }, run);
    expect(run.steps).toContain("Checking your applies on NaukriGulf");
    expect(await statusOf(result.applicationId)).toBe("SENT");
  });

  it("says when NaukriGulf limits applies, and turns away other sources", async () => {
    fake.quota = true;
    await expect(naukriGulfApplyJob.run({ posting }, context())).rejects.toThrow(/NaukriGulf is limiting applies right now/);
    await expect(naukriGulfApplyJob.run({ posting: { ...posting, source: "NAUKRI" } }, context())).rejects.toThrow("Only NaukriGulf postings can be applied to here.");
  });
});
