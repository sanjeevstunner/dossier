import "server-only";

import { ApplicationStatus } from "@/generated/prisma/enums";
import type { PostingFit } from "@/lib/fit";
import type { FoundPosting } from "@/lib/job-search/search";
import { prisma } from "@/lib/prisma";

// Scores kept per posting (#208): from Score in Find jobs, or the job agent.

/** Keeps a posting's score, replacing an older one. */
export async function saveScore(posting: Pick<FoundPosting, "source" | "externalId">, fit: PostingFit, scoredWith: string): Promise<void> {
  const where = { source_externalId: { source: posting.source, externalId: posting.externalId } };
  const data = { score: fit.score, reasons: fit.reasons, redFlags: fit.redFlags, scoredWith };
  await prisma.postingScore.upsert({ where, create: { source: posting.source, externalId: posting.externalId, ...data }, update: data });
}

/**
 * Scoring a saved posting makes it an application in Scored, with the fit
 * kept on it, so the user can write a resume or upload theirs. Scoring it
 * again refreshes the score. A posting that isn't saved, was dismissed, or
 * already has an application further along is left alone.
 */
export async function keepScoreOnApplication(posting: Pick<FoundPosting, "source" | "externalId">, fit: PostingFit): Promise<void> {
  const scored = { score: fit.score, scoreReasons: fit.reasons, scoreRedFlags: fit.redFlags };
  await prisma.$transaction(async (tx) => {
    const where = { source_externalId: { source: posting.source, externalId: posting.externalId } };
    const row = await tx.posting.findUnique({ where });
    if (!row || !row.savedAt || row.dismissedAt) return;
    if (row.applicationId) {
      await tx.application.updateMany({ where: { id: row.applicationId, status: ApplicationStatus.SCORED }, data: scored });
      return;
    }
    const application = await tx.application.create({
      data: {
        status: ApplicationStatus.SCORED,
        title: row.title,
        company: row.company,
        role: row.title,
        location: row.place,
        salary: row.salary,
        postingUrl: row.url,
        postingText: row.description,
        ...scored,
      },
    });
    await tx.posting.update({ where, data: { applicationId: application.id } });
  });
}
