import "server-only";

import { z } from "zod";

import { ApplicationStatus } from "@/generated/prisma/enums";
import { credentialsFor, loadJobSearchConfig, requestContext } from "@/lib/job-search/config";
import { JobSearchError } from "@/lib/job-search/errors";
import { naukriGulfApply, naukriGulfHasApplied } from "@/lib/job-search/naukrigulf";
import { foundPostingSchema } from "@/lib/job-search/search";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { applyStatusChange } from "@/lib/status-changes";

import { postingApplication } from "./easy-apply";
import { defineJob, JobFailure } from "./runner";

/**
 * Easy apply on NaukriGulf, through NopeRi. Simpler than Naukri's
 * (easy-apply.ts): NopeRi's NaukriGulf apply sends the resume already on the
 * NaukriGulf profile and answers no questions. The posting's application is
 * drafted first, as for Naukri, so it's on the board either way; once
 * NaukriGulf confirms the apply, it moves to Sent. A job that wants more (a
 * questionnaire, a gap in the profile) or applies on the company site stays
 * a draft, with what NaukriGulf said.
 */
export const naukriGulfApplyJob = defineJob({
  type: "naukrigulf-easy-apply",
  input: z.object({ posting: foundPostingSchema }),
  // The same shape as Naukri's, so Find jobs shows either.
  result: z.object({
    applicationId: z.string(),
    answered: z.array(z.object({ question: z.string(), answer: z.string() })),
    missing: z.array(z.string()).default([]),
  }),
  async run({ posting }, job) {
    const { step, signal } = job;
    if (posting.source !== "NAUKRIGULF") throw new JobFailure("Only NaukriGulf postings can be applied to here.");
    const credentials = credentialsFor(await loadJobSearchConfig(), "NAUKRIGULF");
    const context = { ...requestContext("NAUKRIGULF"), signal };
    const jobId = posting.externalId;

    try {
      await step("Adding it to your board");
      const applicationId = await postingApplication(posting, job);

      await step("Applying on NaukriGulf with your profile's resume");
      const result = await naukriGulfApply(credentials, jobId, context);
      if (result.companySite) {
        throw new JobFailure("This job applies on the company site, so the agent can't apply for you. Open the posting on NaukriGulf to apply there.");
      }
      if (result.needsMore) {
        const said = result.message ? `: “${result.message}”` : "";
        throw new JobFailure(`NaukriGulf wants more before this apply${said}. Finish it on naukrigulf.com; it stays a draft on your board.`);
      }

      // Not confirmed: it may have gone through before (a Retry, or an apply done on NaukriGulf), which its history shows.
      if (!result.applied) {
        await step("Checking your applies on NaukriGulf");
        if (!(await naukriGulfHasApplied(credentials, jobId, context))) {
          logServerError("naukrigulf easy apply", new Error(`not confirmed: status ${result.status}, message ${JSON.stringify(result.message)}`));
          const said = result.message ? `: “${result.message}”` : result.status ? ` (status ${result.status})` : ".";
          throw new JobFailure(`NaukriGulf didn't confirm the application${said} It stays a draft on your board.`);
        }
      }

      await step("Moving it to Sent");
      const body = result.alreadyApplied ? "Already applied on NaukriGulf." : "Applied on NaukriGulf easy apply, with the resume on the NaukriGulf profile.";
      await prisma.note.create({ data: { applicationId, body } });
      await applyStatusChange(prisma, applicationId, ApplicationStatus.SENT);
      return { applicationId, answered: [], missing: [] };
    } catch (error) {
      // NopeRi answers 429 when NaukriGulf limits applies.
      if (error instanceof JobSearchError && error.problem === "quota") {
        throw new JobFailure("NaukriGulf is limiting applies right now, so nothing was sent. It stays a draft on your board; try again later.");
      }
      if (error instanceof JobSearchError) throw new JobFailure(error.message);
      throw error;
    }
  },
});
