import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { NaukriAnswers, NaukriQuestion } from "@/lib/job-search/naukri";
import type { FoundPosting } from "@/lib/job-search/search";
import { createTestClient, resetDatabase } from "@/test/db";

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
  return { loadProfile: async () => demoProfile() };
});
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({}),
  credentialsFor: () => ({ url: "http://noperi", apiKey: "k" }),
  requestContext: () => ({}),
}));
vi.mock("@/lib/job-search/find", () => ({ fullText: async () => "The whole posting." }));

const fake = vi.hoisted(() => ({
  external: false,
  questionnaire: [] as NaukriQuestion[],
  applies: [] as { skills: unknown; sid?: string; answers?: NaukriAnswers }[],
  /** What Naukri says to the apply that sends the answers (or to the first, without a questionnaire). */
  final: { applied: true, status: 200 as number | null, message: "You have successfully applied to this job." as string | null },
  inHistory: false,
  reply: {} as unknown,
}));
vi.mock("@/lib/job-search/naukri", () => ({
  naukriApplyInfo: async () => ({ externalApply: fake.external, skills: { mandatory: ["LLM"], optional: ["RAG"] } }),
  naukriApply: async (_c: unknown, _id: string, body: { skills: unknown; sid?: string; answers?: NaukriAnswers }) => {
    fake.applies.push(body);
    const asking = !body.answers && fake.questionnaire.length > 0;
    return asking ? { applied: false, status: null, message: null, sid: "17938819617101388", questionnaire: fake.questionnaire } : { ...fake.final, sid: body.sid ?? "1", questionnaire: [] };
  },
  naukriHasApplied: async () => fake.inHistory,
}));
vi.mock("@/lib/log", () => ({ logServerError: () => {} }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () => new MockProvider({ reply: () => fake.reply }),
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
  Object.assign(fake, { external: false, questionnaire: [], applies: [], final: { applied: true, status: 200, message: "You have successfully applied to this job." }, inHistory: false, reply: {} });
});
afterAll(() => prisma().$disconnect());

describe("Naukri easy apply agent", () => {
  it("answers what Naukri can't fill itself, as labels with the same sid, and puts the confirmed application in Sent", async () => {
    fake.questionnaire = questions;
    fake.reply = { answers: [found("52869508", "newOption1"), found("52869515", "0")] };
    const run = context();

    const result = await easyApplyJob.run({ posting }, run);

    expect(run.steps).toEqual(["Checking it's an easy apply", "Applying on Naukri", "Answering 2 questions", "Sending your answers", "Adding it to your board"]);
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

    // Run again (Retry): still one card.
    await easyApplyJob.run({ posting }, context());
    expect(await prisma().application.count()).toBe(1);
  });

  it("applies straight away when there's no questionnaire", async () => {
    const run = context();
    await easyApplyJob.run({ posting }, run);
    expect(run.steps).toEqual(["Checking it's an easy apply", "Applying on Naukri", "Adding it to your board"]);
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

  it("stops before sending anything when the profile can't answer a question", async () => {
    fake.questionnaire = questions;
    fake.reply = { answers: [found("52869508", "newOption1"), { id: "52869515", answer: "", found: false, missing: "Whether you'd relocate to Chennai" }] };
    await expect(easyApplyJob.run({ posting }, context())).rejects.toThrow(/relocate to Chennai.*Facts about me.*Nothing was sent/);
    expect(fake.applies).toHaveLength(1);
    expect(await prisma().application.count()).toBe(0);
  });

  it("adds nothing to the board when Naukri doesn't confirm and its history doesn't list it", async () => {
    fake.final = { applied: false, status: 409, message: null };
    await expect(easyApplyJob.run({ posting }, context())).rejects.toThrow(/didn't confirm the application \(status 409\)/);
    expect(await prisma().application.count()).toBe(0);
  });

  it("puts it in Sent when Naukri doesn't confirm a second apply but lists it as applied", async () => {
    fake.final = { applied: false, status: 409, message: null };
    fake.inHistory = true;
    const run = context();
    await easyApplyJob.run({ posting }, run);
    expect(run.steps).toContain("Checking your applies on Naukri");
    expect((await prisma().application.findFirstOrThrow()).status).toBe("SENT");
  });

  it("refuses company-site jobs without applying", async () => {
    fake.external = true;
    await expect(easyApplyJob.run({ posting }, context())).rejects.toThrow(/company site/);
    expect(fake.applies).toHaveLength(0);
  });

  it("keys a posting's easy apply, so a second click follows the first", () => {
    expect(easyApplyJobKey(posting)).toBe("easy-apply:NAUKRI:123");
  });
});
