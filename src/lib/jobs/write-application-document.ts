import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { DocumentKind, VersionCause } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { extractPosting, matchRequirements, tailorResume, writeCoverLetter } from "@/lib/ai/tasks";
import { calendarDay } from "@/lib/application-documents";
import { extractedOf, extractedSchema, matchSchema, type Extracted, type Match } from "@/lib/application-data";
import { documentLabels } from "@/lib/document-labels";
import { documentLanguage } from "@/lib/document-language";
import { saveVersion } from "@/lib/document-versions";
import { newFrame, withFrame } from "@/lib/letter-frame";
import { logServerError } from "@/lib/log";
import { fitResumeToPages } from "@/lib/page-limit";
import { prisma } from "@/lib/prisma";
import { loadFactTexts, loadProfile } from "@/lib/profile-data";
import { maxPages } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import { defineJob } from "./runner";

/** The key of an application's catching up, to find it again after a reload. */
export const documentJobKey = (applicationId: string) => `document:${applicationId}`;

/** What it writes: "How you match" on the Job posting tab, the resume or the cover letter. */
export const CATCH_UP_KINDS = ["match", "resume", "letter"] as const;
export type CatchUpKind = (typeof CATCH_UP_KINDS)[number];

/**
 * Catches an application added by hand up with the AI: reads its posting
 * and matches it against the profile when that hasn't happened yet, then
 * writes the resume or cover letter it's missing, from the profile and, when
 * `source` is the user's own uploaded version, tailored from that. The
 * document starts its history like one written at creation (E8-10).
 */
export const writeApplicationDocumentJob = defineJob({
  type: "write-application-document",
  input: z.object({
    applicationId: z.string().min(1),
    kind: z.enum(CATCH_UP_KINDS),
    /** The text of the user's own resume or cover letter, to tailor. */
    source: z.string().max(30_000).optional(),
  }),
  result: z.object({ kind: z.enum(CATCH_UP_KINDS) }),
  async run({ applicationId, kind, source }, { step, signal }) {
    await step("Reading the posting");
    const application = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    const [provider, options, profile, facts, settings] = await Promise.all([
      getAiProvider(),
      loadTaskOptions(),
      loadProfile(),
      loadFactTexts(applicationId),
      loadSettings(),
    ]);

    let extracted: Extracted | null = extractedSchema.safeParse(application.extracted).data ?? null;
    let match: Match | null = matchSchema.safeParse(application.match).data ?? null;
    if (!extracted || !match) {
      const posting = application.postingText;
      const extraction = extracted ? null : await extractPosting(provider, { posting }, { ...options, signal });
      extracted = extraction?.data ?? extracted!;
      await step("Checking it against your profile");
      const matching = await matchRequirements(provider, { requirements: extracted.requirements, profile }, { ...options, signal });
      match = matching.data;
      await prisma.application.update({
        where: { id: applicationId },
        data: {
          extracted,
          match,
          matchedWith: matching.promptVersion,
          ...(extraction ? { extractedWith: extraction.promptVersion } : {}),
        },
      });
    }
    if (kind === "match") return { kind };

    // The details as the user keeps them win over what the posting says.
    const job = { ...extracted, ...detailsOf(extractedOf({ ...application, extracted: null })) };
    const language = application.language || settings.docLanguage || extracted.language || "English";
    const writing = { profile, extracted: job, match, facts, posting: application.postingText, source };
    const taskOptions = { ...options, language, signal };

    let units;
    let writtenWith;
    if (kind === "resume") {
      await step("Tailoring your resume");
      ({ data: units, promptVersion: writtenWith } = await tailorResume(provider, writing, taskOptions));
    } else {
      await step("Writing your cover letter");
      const letter = await writeCoverLetter(provider, { ...writing, tone: application.tone }, taskOptions);
      writtenWith = letter.promptVersion;
      // The sender, date and signature come from the profile, as at creation (E8-11).
      units = withFrame(
        letter.data,
        newFrame({
          basics: profile.basics,
          company: application.company,
          location: application.location,
          date: calendarDay(application.sentAt ?? undefined),
          dateFormat: settings.dateFormat,
          lang: documentLanguage(language, letter.data.map((unit) => unit.text).join(" ")).lang,
          labels: documentLabels(language),
        }),
      );
    }

    await step("Saving it");
    const documentKind = kind === "resume" ? DocumentKind.RESUME : DocumentKind.COVER_LETTER;
    try {
      await prisma.$transaction(async (tx) => {
        const document = await tx.document.create({
          data: { applicationId, kind: documentKind, units, themeId: settings.baseThemeId, writtenWith },
        });
        await saveVersion(tx, document.id, units, { cause: VersionCause.WRITTEN });
        if (!application.language) await tx.application.update({ where: { id: applicationId }, data: { language } });
      });
    } catch (error) {
      // Written meanwhile, from another tab: that one stays.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { kind };
      throw error;
    }

    // E10-10: trimmed to the page limit, as at creation. A failure leaves it as written.
    const limit = maxPages(settings.pageLimit);
    if (kind === "resume" && limit) {
      await fitResumeToPages(applicationId, profile, limit).catch((error: unknown) => logServerError("one-page trimming", error));
    }
    return { kind };
  },
});

/** The details the user has filled in, without the empty ones. */
function detailsOf(extracted: Extracted): Partial<Extracted> {
  return Object.fromEntries(Object.entries(extracted).filter(([key, value]) => key !== "requirements" && typeof value === "string" && value)) as Partial<Extracted>;
}
