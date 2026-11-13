import "server-only";

import { z } from "zod";

import { ApplicationStatus, DocumentKind } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { answerQuestionnaire } from "@/lib/ai/tasks";
import { createApplicationFromDocuments } from "@/lib/application-create";
import { PDF_TYPE } from "@/lib/application-files";
import { detailsFrom } from "@/lib/connector/draft";
import { resolveFileName } from "@/lib/file-name";
import { credentialsFor, loadJobSearchConfig, requestContext } from "@/lib/job-search/config";
import { JobSearchError } from "@/lib/job-search/errors";
import { fullText } from "@/lib/job-search/find";
import { naukriApply, naukriApplyInfo, naukriHasApplied, type NaukriAnswers, type NaukriResume } from "@/lib/job-search/naukri";
import { foundPostingSchema, postingText, type FoundPosting } from "@/lib/job-search/search";
import { renderPdf } from "@/lib/pdf/render";
import { easyApplyJobKey, storePosting } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { logServerError } from "@/lib/log";
import { loadFactTexts, loadProfile, loadProfileName } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { applyStatusChange } from "@/lib/status-changes";

import { checkAnswers, reviewedAnswersSchema, reviewQuestions } from "@/lib/easy-apply-answers";
import { readPostingJob } from "./read-posting";
import { writeApplicationDocumentJob } from "./write-application-document";
import { defineJob, JobFailure, type JobContext } from "./runner";
import { writeDocumentsJob } from "./write-documents";

export { easyApplyJobKey };

/**
 * The apply agent (upstream NopeRi's apply_agent): applies to a Naukri easy
 * apply job through NopeRi with a resume tailored to it, answers its
 * questionnaire from the profile, and once Naukri confirms it ("You have
 * successfully applied"), moves the application to Sent. The tailored resume
 * goes out with the apply only: NopeRi backs up the Naukri profile's resume,
 * puts the tailored one there for the apply, and puts the original back. Questions Naukri fills from the Naukri profile (CTC, notice
 * period…) are left to it, as its own page does. A question the profile can't
 * answer stops it before anything is sent.
 */
export const easyApplyJob = defineJob({
  type: "naukri-easy-apply",
  /** `answers`: the user's reviewed answers, sent as they are in place of the agent's. `resumeConfirmed`: the user has seen the resume that goes out. */
  input: z.object({ posting: foundPostingSchema, answers: reviewedAnswersSchema.optional(), resumeConfirmed: z.boolean().optional() }),
  /** `missing` lists what the profile doesn't say: then nothing was sent, and the facts the user adds let it try again. */
  result: z.object({
    applicationId: z.string(),
    answered: z.array(z.object({ question: z.string(), answer: z.string() })),
    missing: z.array(z.string()).default([]),
    /** Set when "Confirm easy apply answers" is on: nothing was sent, and the user's answers decide. */
    review: z
      .object({
        questions: z.array(
          z.object({
            id: z.string(),
            text: z.string(),
            type: z.enum(["text", "choice", "multi"]),
            options: z.array(z.string()),
            required: z.boolean(),
            maxLength: z.number(),
            suggested: z.union([z.string(), z.array(z.string())]),
          }),
        ),
        /** Set while the resume still needs confirming, before the first apply; null once it has been. */
        resume: z.enum(["written", "uploaded"]).nullable(),
      })
      .optional(),
  }),
  async run({ posting, answers: reviewed, resumeConfirmed }, job) {
    const { step, signal } = job;
    if (posting.source !== "NAUKRI") throw new JobFailure("Only Naukri postings can be applied to from here.");
    const credentials = credentialsFor(await loadJobSearchConfig(), "NAUKRI");
    const context = { ...requestContext("NAUKRI"), signal };
    const jobId = posting.externalId;

    try {
      await step("Checking it's an easy apply");
      const { externalApply, skills } = await naukriApplyInfo(credentials, jobId, context);
      if (externalApply) throw new JobFailure("This job applies on the company site, so the agent can't apply for you. Use “Apply on company site”.");

      await step("Tailoring your resume");
      const { applicationId, resume, resumeSource } = await tailoredResume(posting, job);

      // The first apply sends the resume (and applies, when there are no questions), so it's confirmed before it.
      const settings = await loadSettings();
      if (settings.confirmApplyAnswers && settings.confirmApplyResume && !resumeConfirmed) {
        return { applicationId, answered: [], missing: [], review: { questions: [], resume: resumeSource } };
      }

      await step("Applying on Naukri with your tailored resume");
      const first = await naukriApply(credentials, jobId, { skills, resume }, context);
      let result = first;
      const answered: { question: string; answer: string }[] = [];

      if (first.questionnaire.length > 0) {
        const toAnswer = first.questionnaire.filter((question) => !question.skippable);
        let answers: NaukriAnswers = {};
        if (toAnswer.length > 0) {
          if (reviewed) {
            // The user's own answers, checked again here: the form isn't the only way in.
            const problem = checkAnswers(toAnswer, reviewed);
            if (problem) throw new JobFailure(`${problem} Nothing was sent.`);
            answers = Object.fromEntries(toAnswer.flatMap((question) => (reviewed[question.id] === undefined ? [] : [[question.id, reviewed[question.id]]])));
          } else {
            await step(`Answering ${toAnswer.length === 1 ? "1 question" : `${toAnswer.length} questions`}`);
            const confirming = settings.confirmApplyAnswers;
            const [provider, options, profile, facts] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile(), loadFactTexts(applicationId)]);
            const suggested = await answerQuestionnaire(provider, { questions: toAnswer, profile, facts, title: posting.title, company: posting.company }, { ...options, signal }).catch((error: unknown) => {
              // The user answers anyway when confirming; otherwise it fails as before.
              if (!confirming) throw error;
              logServerError("easy apply suggestions", error);
              return { data: { answers: {} as NaukriAnswers, missing: [] as string[] } };
            });
            // Nothing is sent: the user checks the agent's answers, and the resume, first.
            if (confirming) {
              return { applicationId, answered: [], missing: [], review: { questions: reviewQuestions(toAnswer, suggested.data.answers), resume: null } };
            }
            // Nothing is sent: the posting asks for these, for this job or the profile, and applies again.
            if (suggested.data.missing.length > 0) return { applicationId, answered: [], missing: suggested.data.missing };
            answers = suggested.data.answers;
          }
          for (const question of toAnswer) {
            const value = answers[question.id];
            if (value !== undefined) answered.push({ question: question.text, answer: Array.isArray(value) ? value.join(", ") : value });
          }
        }

        await step("Sending your answers");
        result = await naukriApply(credentials, jobId, { skills, sid: first.sid, answers, resume }, context);
        if (result.questionnaire.length > 0) throw new JobFailure("Naukri didn't take the answers. Apply on Naukri yourself to finish.");
      }

      // Not confirmed: it may have gone through before (a Retry, or an apply done on Naukri), which its history shows.
      if (!result.applied) {
        await step("Checking your applies on Naukri");
        if (!(await naukriHasApplied(credentials, jobId, context))) {
          logServerError("naukri easy apply", new Error(`not confirmed: status ${result.status}, message ${JSON.stringify(result.message)}`));
          const said = result.message ? `: “${result.message}”` : result.status ? ` (status ${result.status})` : ".";
          throw new JobFailure(`Naukri didn't confirm the application${said} It stays a draft on your board.`);
        }
      }

      await step("Moving it to Sent");
      // What the agent told Naukri, kept on the application's Notes.
      if (answered.length > 0) {
        const body = ["Answered on Naukri easy apply:", ...answered.map(({ question, answer }) => `\nQ: ${question}\nA: ${answer}`)].join("\n");
        await prisma.note.create({ data: { applicationId, body } });
      }
      await applyStatusChange(prisma, applicationId, ApplicationStatus.SENT);
      return { applicationId, answered, missing: [] };
    } catch (error) {
      // NopeRi answers 429 when Naukri's daily apply limit is used up.
      if (error instanceof JobSearchError && error.problem === "quota") {
        throw new JobFailure("You've reached Naukri's daily apply limit, so nothing was sent. It stays a draft on your board; try again tomorrow.");
      }
      if (error instanceof JobSearchError) throw new JobFailure(error.message);
      throw error;
    }
  },
});

/**
 * The posting's application and its resume as a PDF for Naukri. An
 * application already started from the posting keeps its resume (as tailored,
 * or the user's own PDF); otherwise one is drafted now, as the job agent
 * drafts one, and stays on the board as a Draft until Naukri confirms.
 */
async function tailoredResume(
  posting: FoundPosting,
  context: JobContext,
): Promise<{ applicationId: string; resume: NaukriResume; resumeSource: "written" | "uploaded" }> {
  const applicationId = await postingApplication(posting, context);
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
    select: { company: true, role: true, documents: { where: { kind: DocumentKind.RESUME }, select: { id: true } }, files: { where: { kind: DocumentKind.RESUME } } },
  });
  // A scored application has neither yet: the AI writes the resume now (which makes it a draft).
  if (application.documents.length === 0 && application.files.length === 0) {
    await writeApplicationDocumentJob.run({ applicationId, kind: "resume" }, context);
    application.documents.push({ id: "written" });
  }
  if (application.documents.length === 0) {
    // The user's own resume, as they uploaded it, until the AI writes one.
    const own = application.files[0];
    if (own?.type !== PDF_TYPE) throw new JobFailure("This application's resume isn't a PDF, and Naukri takes only PDFs. Write one or upload a PDF, then try again. Nothing was sent.");
    return { applicationId, resumeSource: "uploaded", resume: { data: new Uint8Array(own.data), name: own.name } };
  }
  const [name, settings] = await Promise.all([loadProfileName(), loadSettings()]);
  const data = await renderPdf(`/print/resume/${applicationId}`).catch((error: unknown) => {
    logServerError("easy apply resume PDF", error);
    throw new JobFailure("Your tailored resume couldn't be printed to a PDF, so nothing was sent. It's saved as a draft on your board; try again once PDFs download there.");
  });
  return {
    applicationId,
    resumeSource: "written",
    resume: {
      data,
      name: resolveFileName(settings.fileNamePattern, { name, company: application.company, role: application.role, doc: DocumentKind.RESUME, date: new Date() }),
    },
  };
}

/**
 * The posting's application: the one already started from it, or a Draft
 * written now, as the job agent drafts one. The posting is stored with its
 * whole text first. Shared with NaukriGulf's apply (naukrigulf-apply.ts).
 */
export async function postingApplication(posting: FoundPosting, context: JobContext): Promise<string> {
  const text = posting.complete ? posting.description : ((await fullText(posting)) ?? posting.description);
  const found = { ...posting, description: text, complete: posting.complete || text !== posting.description };
  const stored = await storePosting(found);
  return stored.applicationId ?? (await draftFor(found, stored.id, context));
}

/** A Draft application for the posting, written the way New application writes one. */
async function draftFor(found: FoundPosting, postingId: string, context: JobContext): Promise<string> {
  const posting = postingText(found);
  const reading = await readPostingJob.run({ posting }, context);
  const settings = await loadSettings();
  const documents = await writeDocumentsJob.run(
    { readJobId: context.id, posting, extracted: reading.extracted, match: reading.match, tone: settings.defaultTone, note: "" },
    context,
  );
  return createApplicationFromDocuments({
    reading: { posting, ...reading },
    documents,
    match: reading.match,
    details: detailsFrom(reading.extracted),
    postingUrl: found.url,
    tone: settings.defaultTone,
    note: "",
    // Linked to the posting, so a Retry finds this one instead of writing another.
    claim: { kind: "connector", postingId },
  });
}
