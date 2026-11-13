"use server";

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { isAiConfigured } from "@/lib/ai/config";
import { reviewedAnswersSchema } from "@/lib/easy-apply-answers";
import { easyApplyJob, easyApplyJobKey } from "@/lib/jobs/easy-apply";
import { naukriGulfApplyJob } from "@/lib/jobs/naukrigulf-apply";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { foundFromPosting } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { nextSort } from "@/lib/profile-entries";
import { applyStatusChange } from "@/lib/status-changes";
import { ApplicationStatus } from "@/generated/prisma/enums";
import { FILTERS, SORT_KEYS, VIEWS } from "@/lib/applications-list";
import { saveSettings } from "@/lib/settings-data";
import { isNopeRi } from "@/lib/job-search/sources";

/** Remembers how the Applications screen was left (LST-7), for the next visit. */
export const rememberListView = action(
  z.object({
    view: z.enum(VIEWS),
    filter: z.enum(FILTERS.map((filter) => filter.value)),
    sort: z.object({ key: z.enum(SORT_KEYS), reversed: z.boolean() }),
  }),
  async ({ view, filter, sort }) => {
    await saveSettings({
      applicationsView: view,
      applicationsFilter: filter,
      applicationsSort: `${sort.reversed ? "-" : ""}${sort.key}`,
    });
    return null;
  },
);

/**
 * "Apply with agent" on a Scored card: the same easy apply as in Find jobs,
 * for the posting the application came from. A second click follows the job
 * already running.
 */
export const startEasyApplyForApplication = action(z.object({ id: z.string().min(1), answers: reviewedAnswersSchema.optional(), resumeConfirmed: z.boolean().optional() }), async ({ id, answers, resumeConfirmed }) => {
  const posting = await prisma.posting.findUnique({ where: { applicationId: id } });
  if (!posting || !isNopeRi(posting.source)) throw new ActionError("Only applications from Naukri and NaukriGulf postings can be applied to from here.");
  if (!(await isAiConfigured())) throw new ActionError(`Choose an AI provider in Settings → AI provider first: it ${posting.source === "NAUKRI" ? "answers Naukri's questions" : "drafts the application"}.`);
  const found = foundFromPosting(posting);
  const key = easyApplyJobKey(found);
  const [unfinished] = await findUnfinishedJobs(key);
  if (unfinished) return { jobId: unfinished.id };
  return { jobId: found.source === "NAUKRI" ? await startJob(easyApplyJob, { posting: found, answers, resumeConfirmed }, { key }) : await startJob(naukriGulfApplyJob, { posting: found }, { key }) };
});

/**
 * Keeps the answers the user checked on an application's facts ("Question:
 * answer"), so later AI runs and retries use them. "Add to draft" also moves
 * a scored application to Draft: it's prepared now, and nothing is sent.
 */
export const saveReviewedAnswers = action(
  z.object({
    applicationId: z.string().min(1),
    answers: z.array(z.object({ question: z.string().max(500), answer: z.string().min(1).max(500) })).max(50),
    moveToDraft: z.boolean(),
  }),
  async ({ applicationId, answers, moveToDraft }, { toast }) => {
    if (!(await prisma.application.findUnique({ where: { id: applicationId }, select: { id: true } }))) throw new ActionError("This application doesn't exist any more.");
    const kept = new Set((await prisma.fact.findMany({ where: { applicationId }, select: { text: true } })).map((fact) => fact.text));
    for (const { question, answer } of answers) {
      const text = `${question}: ${answer}`.slice(0, 1000);
      if (kept.has(text)) continue;
      await prisma.fact.create({ data: { applicationId, text, sort: await nextSort(prisma.fact) } });
    }
    if (moveToDraft) {
      const found = await prisma.application.findUnique({ where: { id: applicationId }, select: { status: true } });
      if (found?.status === ApplicationStatus.SCORED) await applyStatusChange(prisma, applicationId, ApplicationStatus.DRAFT);
      toast("Added to your draft. Nothing was sent.");
    }
    return null;
  },
);
