import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import type { ChatCall } from "@/lib/ai/provider";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../prisma/seed/built-ins";

import { writeApplicationDocumentJob } from "./write-application-document";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const provider = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => provider.current }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: false, language: null }) }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile(), loadFactTexts: async () => [] };
});
// Trimming renders PDFs; the resume fits here.
vi.mock("@/lib/page-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/page-limit")>()),
  fitResumeToPages: vi.fn(async () => ({ trimmed: [], fits: true })),
}));
vi.mock("./runner", () => ({ defineJob: <T,>(definition: T) => definition }));

const prisma = () => db.client!;
const context = { id: "test-job", step: async () => {}, signal: new AbortController().signal };

// Only an amount of experience, so matching needs no model.
const extracted = {
  title: "Senior Product Designer · Ledgerly",
  company: "Ledgerly",
  role: "Senior Product Designer",
  location: "Amsterdam",
  mode: null,
  salary: null,
  deadline: null,
  requirements: [{ text: "5+ years of product design", kind: "years", skill: null, years: 5, language: null }],
  asksForReferences: false,
  language: "English",
};
const letterAnswer = {
  recipient: "Ledgerly · Hiring team",
  greeting: "Dear Ledgerly team,",
  paragraphs: [{ label: "Why this role", text: "Payments are where trust is won." }],
  signOff: "Warm regards,",
};

function mock() {
  const answers: Record<string, unknown> = {
    extracted_posting: extracted,
    cover_letter: letterAnswer,
    tailored_resume: { summary: "Designer of payment products.", roles: [], projects: [], skills: [], education: [] },
  };
  const mocked = new MockProvider({ reply: (call: ChatCall) => answers[call.json?.name ?? ""] ?? "OK" });
  provider.current = mocked;
  return mocked;
}

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  await prisma().application.create({
    data: { id: "app-1", company: "Ledgerly B.V.", role: "Senior Product Designer", postingText: "Ledgerly is hiring a Senior Product Designer." },
  });
});
afterAll(() => prisma().$disconnect());

describe("writeApplicationDocumentJob", () => {
  it("reads and matches the posting of an application added by hand", async () => {
    mock();
    expect(await writeApplicationDocumentJob.run({ applicationId: "app-1", kind: "match" }, context)).toEqual({ kind: "match" });
    const application = await prisma().application.findUniqueOrThrow({ where: { id: "app-1" }, include: { documents: true } });
    expect(application.extracted).toEqual(extracted);
    expect(application.match).toMatchObject({ items: [{ requirement: "5+ years of product design" }] });
    expect(application.extractedWith).toMatch(/^extract-posting@/);
    expect(application.matchedWith).toMatch(/^match-requirements@/);
    expect(application.documents).toEqual([]);
  });

  it("writes the missing cover letter with its frame, tailored from the user's own", async () => {
    const mocked = mock();
    await writeApplicationDocumentJob.run({ applicationId: "app-1", kind: "letter", source: "Dear hiring team, I build payment tools." }, context);
    const letter = await prisma().document.findUniqueOrThrow({
      where: { applicationId_kind: { applicationId: "app-1", kind: "COVER_LETTER" } },
      include: { versions: true },
    });
    expect(letter.writtenWith).toMatch(/^write-cover-letter@/);
    expect(letter.themeId).not.toBeNull();
    expect((letter.units as { id: string }[]).map((unit) => unit.id)).toEqual(
      expect.arrayContaining(["sender", "date", "recipient", "greeting", "paragraph:1", "sign-off", "signature"]),
    );
    expect(letter.versions.map((version) => version.cause)).toEqual(["WRITTEN"]);
    const prompt = mocked.calls.find((call) => call.json?.name === "cover_letter")!.messages.map((message) => message.content).join("\n");
    expect(prompt).toContain("<own-version>\nDear hiring team, I build payment tools.\n</own-version>");
    // The company as the user keeps it, not as the posting says.
    expect(prompt).toContain("Ledgerly B.V.");
  });

  it("writes the missing resume from the profile, and keeps one written meanwhile", async () => {
    mock();
    await writeApplicationDocumentJob.run({ applicationId: "app-1", kind: "resume" }, context);
    const resume = await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind: "RESUME" } } });
    expect(resume.writtenWith).toMatch(/^tailor-resume@/);
    // A second run finds it written and leaves it be.
    await writeApplicationDocumentJob.run({ applicationId: "app-1", kind: "resume" }, context);
    expect(await prisma().document.count({ where: { kind: "RESUME" } })).toBe(1);
  });
});
