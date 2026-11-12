"use server";

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { isAiConfigured } from "@/lib/ai/config";
import { easyApplyJob, easyApplyJobKey } from "@/lib/jobs/easy-apply";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { foundFromPosting } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { FILTERS, SORT_KEYS, VIEWS } from "@/lib/applications-list";
import { saveSettings } from "@/lib/settings-data";

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
export const startEasyApplyForApplication = action(z.object({ id: z.string().min(1) }), async ({ id }) => {
  const posting = await prisma.posting.findUnique({ where: { applicationId: id } });
  if (posting?.source !== "NAUKRI") throw new ActionError("Only applications from Naukri postings can be applied to from here.");
  if (!(await isAiConfigured())) throw new ActionError("Choose an AI provider in Settings → AI provider first: it answers Naukri's questions.");
  const found = foundFromPosting(posting);
  const key = easyApplyJobKey(found);
  const [unfinished] = await findUnfinishedJobs(key);
  return { jobId: unfinished?.id ?? (await startJob(easyApplyJob, { posting: found }, { key })) };
});
