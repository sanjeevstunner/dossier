import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { NaukriAnswers, NaukriQuestion, NaukriResume } from "@/lib/job-search/naukri";
import type { FoundPosting } from "@/lib/job-search/search";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../prisma/seed/built-ins";
import { MockProvider } from "../ai/providers/mock";

import { easyApplyJob, easyApplyJobKey } from "./easy-apply";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  const { prisma } = await import("@/lib/prisma");
  // An application's facts, as the agent loads them, from the test database.
  const loadFactTexts = async (applicationId: string) =>
    (await prisma.fact.findMany({ where: { applicationId }, orderBy: { sort: "asc" } })).map((fact) => fact.text);
  return { loadProfile: async () => demoProfile(), loadProfileName: async () => "Jane Doe", loadFactTexts };
});
// Dossier's own model drafts the application; here it's done.
vi.mock("./read-posting", () => ({
  readPostingJob: {
    run: async () => ({
      extracted: { title: null, company: "Acme", role: "Product Designer", location: "Bengaluru", mode: null, salary: null, deadline: null, requirements: [], asksForReferences: false, language: "English" },
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
      run: async () => ({ resume: demoResumeUnits(), resumeWith: "tailor-resume@7", letter: demoLetterUnits(), letterWith: "write-cover-letter@6" }),
    },
  };
});
vi.mock("@/lib/page-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/page-limit")>()),
  fitResumeToPages: async () => ({ trimmed: [], fits: true }),
}));
const printed = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/pdf/render", () => ({ renderPdf: async (path: string) => (printed.push(path), new TextEncoder().encode("%PDF-tailored")) }));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({}),
  credentialsFor: () => ({ url: "http://noperi", apiKey: "k" }),
  requestContext: () => ({}),
}));
vi.mock("@/lib/job-search/find", () => ({ fullText: async () => "The whole posting." }));

const fake = vi.hoisted(() => ({
  external: false,
  questionnaire: [] as NaukriQuestion[],
  applies: [] as { skills: unknown; sid?: string; answers?: NaukriAnswers; resume?: NaukriResume }[],
  /** What Naukri says to the apply that sends the answers (or to the first, without a questionnaire). */
  final: { applied: true, status: 200 as number | null, message: "You have successfully applied to this job." as string | null },
  inHistory: false,
  reply: {} as unknown,
  resumes: [] as (NaukriResume | undefined)[],
  prompts: [] as string[],
}));
vi.mock("@/lib/job-search/naukri", () => ({
  naukriApplyInfo: async () => ({ externalApply: fake.external, skills: { mandatory: ["LLM"], optional: ["RAG"] } }),
  naukriApply: async (_c: unknown, _id: string, { resume, ...body }: { skills: unknown; sid?: string; answers?: NaukriAnswers; resume?: NaukriResume }) => {
    fake.applies.push(body);
    fake.resumes.push(resume);
    const asking = !body.answers && fake.questionnaire.length > 0;
    return asking ? { applied: false, status: null, message: null, sid: "17938819617101388", questionnaire: fake.questionnaire } : { ...fake.final, sid: body.sid ?? "1", questionnaire: [] };
  },
  naukriHasApplied: async () => fake.inHistory,
}));
vi.mock("@/lib/log", () => ({ logServerError: () => {} }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () => new MockProvider({ reply: (call) => (fake.prompts.push(JSON.stringify(call)), fake.reply) }),
}));

const prisma = () => db.client!;
const posting: FoundPosting = {
  source: "NAUKRI",
  externalId: "123",
  title: "Product Designer",
  company: "Acme",
  place: "Bengaluru",
  remote: null,
  salary: "",
  postedAt: null,
  url: "https://www.naukri.com/job-listings-123",
  via: "",
  description: "The start…",
  complete: false,
};
const q = (id: string, text: string, type: NaukriQuestion["type"], options: Record<string, string>, skippable = false): NaukriQuestion => ({
  id,
  text,
  type,
  options,
  required: true,
  skippable,
  prefill: skippable ? ["750000"] : [],
});
// As in a live apply: Naukri fills CTC from the Naukri profile (skippable).
const questions = [
  q("52869508", "Have you worked hands-on with LLMs?", "choice", { newOption1: "Yes", newOption2: "No" }),
  q("52869515", "Are you residing in or willing to relocate to Chennai?", "choice", { 0: "Yes", 1: "No" }),
  q("52869513", "What is your current CTC in Lacs per annum?", "text", {}, true),
];
const found = (id: string, answer: string) => ({ id, answer, found: true, missing: "" });
const context = () => {
  const steps: string[] = [];
  return { id: "easy-apply-job", steps, step: async (name: string) => void steps.push(name), signal: new AbortController().signal };
};

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  printed.length = 0;
  Object.assign(fake, { external: false, questionnaire: [], applies: [], resumes: [], prompts: [], final: { applied: true, status: 200, message: "You have successfully applied to this job." }, inHistory: false, reply: {} });
});
afterAll(() => prisma().$disconnect());

describe("Naukri easy apply agent", () => {
  it("answers what Naukri can't fill itself, as labels with the same sid, and puts the confirmed application in Sent", async () => {
    fake.questionnaire = questions;
    fake.reply = { answers: [found("52869508", "newOption1"), found("52869515", "0")] };
    const run = context();

    const result = await easyApplyJob.run({ posting }, run);

    expect(run.steps).toEqual(["Checking it's an easy apply", "Tailoring your resume", "Applying on Naukri with your tailored resume", "Answering 2 questions", "Sending your answers", "Moving it to Sent"]);
    expect(fake.applies).toEqual([
      { skills: { mandatory: ["LLM"], optional: ["RAG"] } },
      { skills: { mandatory: ["LLM"], optional: ["RAG"] }, sid: "17938819617101388", answers: { "52869508": ["Yes"], "52869515": ["Yes"] } },
    ]);
    expect(result.answered).toEqual([
      { question: "Have you worked hands-on with LLMs?", answer: "Yes" },
      { question: "Are you residing in or willing to relocate to Chennai?", answer: "Yes" },
    ]);
    const application = await prisma().application.findUniqueOrThrow({ where: { id: result.applicationId }, include: { posting: true } });
    expect(application).toMatchObject({ status: "SENT", company: "Acme", role: "Product Designer", postingText: "The whole posting." });
    expect(application.sentAt).not.toBeNull();
    expect(application.posting?.externalId).toBe("123");

    // Both applies, the first and the one with the answers, carry the tailored resume, printed from this application.
    expect(printed).toEqual([`/print/resume/${result.applicationId}`]);
    expect(fake.resumes.map((resume) => [new TextDecoder().decode(resume!.data), resume!.name])).toEqual([
      ["%PDF-tailored", "Jane Doe – Acme – Resume.pdf"],
      ["%PDF-tailored", "Jane Doe – Acme – Resume.pdf"],
    ]);

    // Run again (Retry): still one card, and its resume isn't written again.
    await easyApplyJob.run({ posting }, context());
    expect(await prisma().application.count()).toBe(1);
    expect(printed).toHaveLength(2);
  });

  it("applies straight away when there's no questionnaire", async () => {
    const run = context();
    await easyApplyJob.run({ posting }, run);
    expect(run.steps).toEqual(["Checking it's an easy apply", "Tailoring your resume", "Applying on Naukri with your tailored resume", "Moving it to Sent"]);
    expect(fake.applies).toHaveLength(1);
    expect(await prisma().application.count()).toBe(1);
  });

  it("sends empty answers when Naukri fills every question itself", async () => {
    fake.questionnaire = [questions[2]];
    const run = context();
    await easyApplyJob.run({ posting }, run);
    expect(run.steps).not.toContain("Answering 1 question");
    expect(fake.applies[1]).toMatchObject({ sid: "17938819617101388", answers: {} });
  });

  it("asks for what the profile can't answer before sending anything, then applies with a fact given for this job", async () => {
    fake.questionnaire = questions;
    fake.reply = { answers: [found("52869508", "newOption1"), { id: "52869515", answer: "", found: false, missing: "Whether you'd relocate to Chennai" }] };
    const asked = await easyApplyJob.run({ posting }, context());
    expect(asked.missing).toEqual(["Whether you'd relocate to Chennai"]);
    expect(fake.applies).toHaveLength(1);
    expect((await prisma().application.findUniqueOrThrow({ where: { id: asked.applicationId } })).status).toBe("DRAFT");

    // The answer, kept for this application only, goes to the questionnaire; the profile is unchanged.
    await prisma().fact.create({ data: { applicationId: asked.applicationId, text: "Whether you'd relocate to Chennai: Yes" } });
    fake.reply = { answers: [found("52869508", "newOption1"), found("52869515", "0")] };
    const applied = await easyApplyJob.run({ posting }, context());
    expect(applied).toMatchObject({ applicationId: asked.applicationId, missing: [] });
    expect(fake.prompts.at(-1)).toContain("Facts the candidate gave for this application");
    expect(fake.prompts.at(-1)).toContain("relocate to Chennai: Yes");
    expect(await prisma().fact.count({ where: { applicationId: null } })).toBe(0);
    expect((await prisma().application.findUniqueOrThrow({ where: { id: asked.applicationId } })).status).toBe("SENT");
  });

  it("adds nothing to the board when Naukri doesn't confirm and its history doesn't list it", async () => {
    fake.final = { applied: false, status: 409, message: null };
    await expect(easyApplyJob.run({ posting }, context())).rejects.toThrow(/didn't confirm the application \(status 409\).*stays a draft/);
    expect((await prisma().application.findFirstOrThrow()).status).toBe("DRAFT");
  });

  it("puts it in Sent when Naukri doesn't confirm a second apply but lists it as applied", async () => {
    fake.final = { applied: false, status: 409, message: null };
    fake.inHistory = true;
    const run = context();
    await easyApplyJob.run({ posting }, run);
    expect(run.steps).toContain("Checking your applies on Naukri");
    expect((await prisma().application.findFirstOrThrow()).status).toBe("SENT");
  });

  it("refuses company-site jobs without applying or drafting", async () => {
    fake.external = true;
    await expect(easyApplyJob.run({ posting }, context())).rejects.toThrow(/company site/);
    expect(fake.applies).toHaveLength(0);
    expect(await prisma().application.count()).toBe(0);
  });

  it("applies with the user's own PDF when the posting's application has no written resume", async () => {
    const stored = await prisma().posting.create({ data: { source: "NAUKRI", externalId: "123", title: "Product Designer", company: "Acme", description: "The whole posting.", complete: true } });
    const own = new TextEncoder().encode("%PDF-mine");
    const application = await prisma().application.create({
      data: { title: "Mine", company: "Acme", role: "Product Designer", files: { create: { kind: "RESUME", name: "My CV.pdf", type: "application/pdf", size: own.length, data: own } } },
    });
    await prisma().posting.update({ where: { id: stored.id }, data: { applicationId: application.id } });

    const result = await easyApplyJob.run({ posting }, context());
    expect(result.applicationId).toBe(application.id);
    expect(printed).toEqual([]);
    expect(fake.resumes.map((resume) => [new TextDecoder().decode(resume!.data), resume!.name])).toEqual([["%PDF-mine", "My CV.pdf"]]);
  });

  it("keys a posting's easy apply, so a second click follows the first", () => {
    expect(easyApplyJobKey(posting)).toBe("easy-apply:NAUKRI:123");
  });
});
