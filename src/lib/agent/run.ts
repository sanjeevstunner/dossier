import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { isAiConfigured } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { scorePosting } from "@/lib/ai/tasks";
import { searchPostings } from "@/lib/job-search";
import { credentialsFor, loadJobSearchConfig, requestContext } from "@/lib/job-search/config";
import { JobSearchError } from "@/lib/job-search/errors";
import { postingKey, postingText, type FoundPosting, type SearchQuery } from "@/lib/job-search/search";
import { startJob, type JobContext } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { saveScore } from "@/lib/posting-scores";
import { postingStates } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";

import { loadAgent, type AgentConfig } from "./agents";
import { agentDedupeKey, candidateData } from "./candidates";
import { agentDraftJob, draftJobKey } from "./draft";
import { logStep, recordRunEnd, recordRunStart } from "./runs";

// One run of the job agent (E16-3): one search, the postings seen before
// dropped, and a score for the newest of the rest. It never sends anything.
// Adapted from avinashbatchala's fork of Dossier.

export const agentScanResultSchema = z.object({
  /** Postings the source returned. */
  found: z.number().int().min(0),
  /** Of those, the ones not seen before. */
  fresh: z.number().int().min(0),
  scored: z.number().int().min(0),
  drafted: z.number().int().min(0),
  /** Found but seen before: saved, dismissed or applied for in Find jobs, or a candidate already. */
  skipped: z.number().int().min(0),
  /** What to tell the user. */
  message: z.string(),
});
export type AgentScanResult = z.infer<typeof agentScanResultSchema>;

const stopped = (message: string): AgentScanResult => ({ found: 0, fresh: 0, scored: 0, drafted: 0, skipped: 0, message });

/** Whether a search is complete enough to run: keywords and a country. */
export const agentQueryReady = (query: SearchQuery) => Boolean(query.keywords.trim() && query.country);

/** Why the agent can't run at all, in words, or null when it's set up. */
export async function agentSetupProblem(query: SearchQuery): Promise<string | null> {
  if (!query.keywords.trim()) return "Add what this agent should look for first.";
  if (!query.country) return "Choose a country for this agent's search first.";
  if (!(await isAiConfigured())) return "Choose an AI provider in Settings → AI provider first.";
  const config = await loadJobSearchConfig();
  if (!config.source) return "Choose a job source in Settings → Job search first.";
  // It searches on its own, which the BA's terms forbid most clearly (#223).
  if (config.source === "ARBEITSAGENTUR") return "The job agent doesn't search the Bundesagentur für Arbeit. Choose JSearch or Adzuna in Settings → Job search for it.";
  try {
    credentialsFor(config, config.source);
  } catch (error) {
    if (error instanceof JobSearchError) return error.message;
    throw error;
  }
  return null;
}

/** The postings from a page that are new to the agent: not saved, dismissed or applied for, and not a candidate already. */
export async function newPostings(postings: readonly FoundPosting[]): Promise<FoundPosting[]> {
  const states = await postingStates(postings);
  const unseen = postings.filter((posting) => {
    const state = states.get(postingKey(posting));
    return !state?.saved && !state?.dismissed && !state?.applicationId;
  });
  const keys = unseen.map(agentDedupeKey);
  const known = await prisma.agentCandidate.findMany({
    where: { OR: [...unseen.map(({ source, externalId }) => ({ source, externalId })), { dedupeKey: { in: keys } }] },
    select: { source: true, externalId: true, dedupeKey: true },
  });
  const seen = new Set(known.flatMap((candidate) => [postingKey(candidate), candidate.dedupeKey]));
  // The same job twice in one page counts once too.
  return unseen.filter((posting, index) => {
    const fresh = !seen.has(postingKey(posting)) && !seen.has(keys[index]);
    seen.add(keys[index]);
    return fresh;
  });
}

const newestFirst = (a: FoundPosting, b: FoundPosting) => (b.postedAt ? Date.parse(b.postedAt) : 0) - (a.postedAt ? Date.parse(a.postedAt) : 0);

/**
 * One run: the first page of results only (one source request), then a
 * score for the newest new postings, up to the agent's maxScores. Each is
 * kept as a candidate, so it doesn't come back for any agent; one below
 * minScore stays out of the queue. With auto-draft on, the best of them get
 * a draft each, up to maxDrafts, each its own job. A scheduled run does
 * nothing while the agent is off. Each run, and each step, goes in its log.
 */
export async function runAgentScan({ agentId, manual }: { agentId: string; manual: boolean }, context: JobContext, now = new Date()): Promise<AgentScanResult> {
  const agent = await loadAgent(agentId);
  if (!agent) return stopped("That agent was deleted.");
  if (!agent.enabled && !manual) return stopped("The agent is off.");

  const runId = await recordRunStart(agent.id, manual, now);
  const step = async (text: string) => {
    await context.step(text);
    await logStep(runId, text);
  };
  const finish = async (result: AgentScanResult, failed = false) => {
    await recordRunEnd(runId, { ...result, failed });
    return result;
  };
  try {
    const setup = await agentSetupProblem(agent.query);
    if (setup) return await finish(stopped(setup), true);
    return await scan(agent, runId, step, context, finish);
  } catch (error) {
    await finish(stopped(context.signal.aborted ? "Cancelled." : "The run didn't finish."), true).catch(() => {});
    throw error;
  }
}

async function scan(
  agent: AgentConfig,
  runId: string,
  step: (text: string) => Promise<void>,
  context: JobContext,
  finish: (result: AgentScanResult, failed?: boolean) => Promise<AgentScanResult>,
): Promise<AgentScanResult> {
  await step("Searching for new postings");
  const config = await loadJobSearchConfig();
  const source = config.source!;
  let postings: FoundPosting[];
  try {
    // The first page only: the agent never asks for a second.
    postings = (await searchPostings(source, credentialsFor(config, source), agent.query, null, requestContext(source))).postings;
  } catch (error) {
    if (error instanceof JobSearchError) return finish(stopped(error.message), true);
    throw error;
  }

  const fresh = await newPostings(postings);
  const counts = { found: postings.length, fresh: fresh.length, skipped: postings.length - fresh.length, drafted: 0 };
  await step(`Found ${postings.length} ${postings.length === 1 ? "posting" : "postings"}, ${fresh.length} new`);
  if (fresh.length === 0) return finish({ ...counts, scored: 0, message: postings.length === 0 ? "The search found no postings this time." : "No new postings this time." });

  const toScore = fresh.toSorted(newestFirst).slice(0, agent.maxScores);
  await step(`Scoring ${toScore.length} ${toScore.length === 1 ? "posting" : "postings"}`);
  const [provider, options, profile] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile()]);
  let scored = 0;
  let queued = 0;
  const kept: string[] = [];
  let problem: string | null = null;
  for (const posting of toScore) {
    if (context.signal.aborted) break;
    try {
      const { data, promptVersion } = await scorePosting(
        provider,
        { posting: postingText(posting), title: posting.title, company: posting.company, place: posting.place, remote: posting.remote, salary: posting.salary, profile },
        { ...options, signal: context.signal },
      );
      const candidate = await prisma.agentCandidate.create({
        data: { ...candidateData(posting, data), agent: { connect: { id: agent.id } }, run: { connect: { id: runId } } },
        select: { id: true },
      });
      // Find jobs shows it too (#208).
      await saveScore(posting, data, promptVersion);
      kept.push(candidate.id);
      scored += 1;
      if (data.score >= agent.minScore) queued += 1;
      await logStep(runId, `Scored ${data.score}: ${[posting.title, posting.company].filter(Boolean).join(" at ") || "a posting"}`);
    } catch (error) {
      // Another run kept it first: it's seen either way.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      // One posting that fails doesn't stop the rest.
      if (error instanceof AiError) {
        problem = error.message;
        await logStep(runId, `Couldn't score ${posting.title || "a posting"}: ${error.message}`);
      } else if (!context.signal.aborted) logServerError("job agent scoring", error);
    }
  }

  // Auto-draft (#197, off by default): the best of this run's, one job each.
  let drafted = 0;
  if (agent.autoDraft && agent.maxDrafts > 0 && !context.signal.aborted) {
    const best = await prisma.agentCandidate.findMany({
      where: { id: { in: kept }, status: AgentCandidateStatus.SCORED, score: { gte: agent.minScore } },
      orderBy: { score: "desc" },
      take: agent.maxDrafts,
      select: { id: true },
    });
    for (const { id } of best) await startJob(agentDraftJob, { candidateId: id }, { key: draftJobKey(id) });
    drafted = best.length;
  }

  const waiting = `${queued} new ${queued === 1 ? "posting is" : "postings are"} waiting for a look.`;
  const message =
    scored === 0
      ? (problem ?? "No postings could be scored this time.")
      : queued === 0
        ? `Scored ${scored} new ${scored === 1 ? "posting" : "postings"}; none reached the minimum score of ${agent.minScore}.`
        : drafted > 0
          ? `${waiting} Preparing ${drafted === 1 ? "a draft for the best one" : `drafts for the best ${drafted}`}.`
          : waiting;
  return finish({ ...counts, scored, drafted, message }, scored === 0 && problem !== null);
}
