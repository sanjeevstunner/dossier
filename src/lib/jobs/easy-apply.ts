import "server-only";

import { z } from "zod";

import { ApplicationStatus } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { answerQuestionnaire } from "@/lib/ai/tasks";
import { createManualApplication } from "@/lib/application-create";
import { credentialsFor, loadJobSearchConfig, requestContext } from "@/lib/job-search/config";
import { JobSearchError } from "@/lib/job-search/errors";
import { fullText } from "@/lib/job-search/find";
import { naukriApply, naukriApplyInfo, naukriHasApplied, type NaukriAnswers } from "@/lib/job-search/naukri";
import { foundPostingSchema, postingKey, type FoundPosting } from "@/lib/job-search/search";
import { storePosting } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { logServerError } from "@/lib/log";
import { loadProfile } from "@/lib/profile-data";
import { applyStatusChange } from "@/lib/status-changes";

import { defineJob, JobFailure } from "./runner";

/** The key of a posting's easy apply, so a second click follows the one under way. */
export const easyApplyJobKey = (posting: Pick<FoundPosting, "source" | "externalId">) => `easy-apply:${postingKey(posting)}`;

/**
 * The apply agent (upstream NopeRi's apply_agent): applies to a Naukri easy
 * apply job through NopeRi, answers its questionnaire from the profile, and
 * once Naukri confirms it ("You have successfully applied"), puts it on the
 * board in Sent. Questions Naukri fills from the Naukri profile (CTC, notice
 * period…) are left to it, as its own page does. A question the profile can't
 * answer stops it before anything is sent.
 */
export const easyApplyJob = defineJob({
  type: "naukri-easy-apply",
  input: z.object({ posting: foundPostingSchema }),
  result: z.object({ applicationId: z.string(), answered: z.array(z.object({ question: z.string(), answer: z.string() })) }),
  async run({ posting }, { step, signal }) {
    if (posting.source !== "NAUKRI") throw new JobFailure("Only Naukri postings can be applied to from here.");
    const credentials = credentialsFor(await loadJobSearchConfig(), "NAUKRI");
    const context = { ...requestContext("NAUKRI"), signal };
    const jobId = posting.externalId;

    try {
      await step("Checking it's an easy apply");
      const { externalApply, skills } = await naukriApplyInfo(credentials, jobId, context);
      if (externalApply) throw new JobFailure("This job applies on the company site, so the agent can't apply for you. Use “Apply on company site”.");

      await step("Applying on Naukri");
      const first = await naukriApply(credentials, jobId, { skills }, context);
      let result = first;
      const answered: { question: string; answer: string }[] = [];

      if (first.questionnaire.length > 0) {
        const toAnswer = first.questionnaire.filter((question) => !question.skippable);
        let answers: NaukriAnswers = {};
        if (toAnswer.length > 0) {
          await step(`Answering ${toAnswer.length === 1 ? "1 question" : `${toAnswer.length} questions`}`);
          const [provider, options, profile] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile()]);
          const { data } = await answerQuestionnaire(provider, { questions: toAnswer, profile, title: posting.title, company: posting.company }, { ...options, signal });
          if (data.missing.length > 0) {
            throw new JobFailure(
              `Naukri asks for something your profile doesn't say: ${data.missing.join("; ")}. Add it to Facts about me in your profile, then try again. Nothing was sent.`,
            );
          }
          answers = data.answers;
          for (const question of toAnswer) {
            const value = answers[question.id];
            if (value !== undefined) answered.push({ question: question.text, answer: Array.isArray(value) ? value.join(", ") : value });
          }
        }

        await step("Sending your answers");
        result = await naukriApply(credentials, jobId, { skills, sid: first.sid, answers }, context);
        if (result.questionnaire.length > 0) throw new JobFailure("Naukri didn't take the answers. Apply on Naukri yourself to finish.");
      }

      // Not confirmed: it may have gone through before (a Retry, or an apply done on Naukri), which its history shows.
      if (!result.applied) {
        await step("Checking your applies on Naukri");
        if (!(await naukriHasApplied(credentials, jobId, context))) {
          logServerError("naukri easy apply", new Error(`not confirmed: status ${result.status}, message ${JSON.stringify(result.message)}`));
          const said = result.message ? `: “${result.message}”` : result.status ? ` (status ${result.status})` : ".";
          throw new JobFailure(`Naukri didn't confirm the application${said} It wasn't added to your board.`);
        }
      }

      await step("Adding it to your board");
      return { applicationId: await toBoard(posting), answered };
    } catch (error) {
      if (error instanceof JobSearchError) throw new JobFailure(error.message);
      throw error;
    }
  },
});

/** The posting's application, moved to Sent; a new one in Sent when it has none. Safe to run again on Retry. */
async function toBoard(posting: FoundPosting): Promise<string> {
  const text = posting.complete ? posting.description : ((await fullText(posting)) ?? posting.description);
  const stored = await storePosting({ ...posting, description: text, complete: posting.complete || text !== posting.description });
  if (stored.applicationId) {
    await applyStatusChange(prisma, stored.applicationId, ApplicationStatus.SENT);
    return stored.applicationId;
  }
  return createManualApplication({
    details: { title: "", company: posting.company, role: posting.title, location: posting.place, mode: "", salary: posting.salary, deadline: "" },
    posting: text,
    postingUrl: posting.url,
    reading: null,
    email: { to: "", subject: "", body: "" },
    status: ApplicationStatus.SENT,
    appliedAt: new Date(),
    postingId: stored.id,
    startupId: null,
  });
}
