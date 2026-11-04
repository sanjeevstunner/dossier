"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { loadAgent } from "@/lib/agent/agents";
import { agentDraftJob, approveCandidate, dismissCandidate, draftJobKey, restoreCandidate } from "@/lib/agent/draft";
import { agentJobKey, agentScanJob } from "@/lib/agent/jobs";
import { agentQueryReady, agentSetupProblem } from "@/lib/agent/run";
import { runLimitWarning } from "@/lib/agent/runs";
import { action, ActionError } from "@/lib/action";
import { EMPTY_QUERY, safeLink, searchQuerySchema } from "@/lib/job-search/search";
import { cancelJob, findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { loadSearch } from "@/lib/posting-searches";
import { prisma } from "@/lib/prisma";

// The Agents screens' actions (E16). Nothing here ever sends anything:
// approving only makes a draft a normal Draft application.

const agentId = z.string().min(1).max(100);

const missing = () => new ActionError("That agent no longer exists.");

/** New agent: off, with the defaults, searching what Find jobs searched last. */
export const createAgent = action(z.object({}), async () => {
  const count = await prisma.agent.count();
  const agent = await prisma.agent.create({
    data: { name: count === 0 ? "Job agent" : `Job agent ${count + 1}`, query: (await loadSearch())?.query ?? EMPTY_QUERY },
    select: { id: true },
  });
  revalidatePath("/agent");
  return { id: agent.id };
});

/**
 * An agent's config, on its screen: each change saves at once. Turning it
 * on needs a search with keywords and a country.
 */
export const saveAgent = action(
  z.object({
    id: agentId,
    name: z.string().trim().min(1, "Give the agent a name.").max(100).optional(),
    enabled: z.boolean().optional(),
    query: searchQuerySchema.optional(),
    hour: z.number().int().min(0).max(23).optional(),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    minScore: z.number().int().min(0).max(100).optional(),
    maxScores: z.number().int().min(1).max(30).optional(),
    maxDrafts: z.number().int().min(0).max(10).optional(),
    autoDraft: z.boolean().optional(),
    maxRunsPerDay: z.number().int().min(1).max(48).optional(),
    manualIntervalMinutes: z.number().int().min(0).max(24 * 60).optional(),
  }),
  async ({ id, ...changes }) => {
    const agent = await loadAgent(id);
    if (!agent) throw missing();
    const query = changes.query ?? agent.query;
    if (changes.enabled && !agentQueryReady(query)) {
      throw new ActionError(query.keywords.trim() ? "Choose a country for the search before turning the agent on." : "Type what the agent should look for before turning it on.");
    }
    await prisma.agent.update({ where: { id }, data: { ...changes, days: changes.days && [...new Set(changes.days)].sort() } });
    revalidatePath("/agent");
    revalidatePath(`/agent/${id}`);
    return null;
  },
);

/** Delete: its runs go with it; what it found stays, so it never comes back. */
export const deleteAgent = action(z.object({ id: agentId }), async ({ id }, { toast }) => {
  for (const job of await findUnfinishedJobs(agentJobKey(id))) await cancelJob(job.id);
  await prisma.agent.deleteMany({ where: { id } });
  revalidateAgent();
  toast("Agent deleted. Its drafts and the postings it found stay.");
  return null;
});

/**
 * Run now (E16-4). Past the agent's own limits it answers with a warning
 * instead of a run; `force` (Run anyway) goes ahead. A run already queued
 * or running is reused rather than started again.
 */
export const runAgentNow = action(z.object({ id: agentId, force: z.boolean().optional() }), async ({ id, force }) => {
  const agent = await loadAgent(id);
  if (!agent) throw missing();
  const setup = await agentSetupProblem(agent.query);
  if (setup) throw new ActionError(setup);
  const [unfinished] = await findUnfinishedJobs(agentJobKey(id));
  if (unfinished) return { jobId: unfinished.id, warning: null };
  if (!force) {
    const runs = await prisma.agentRun.findMany({ where: { agentId: id }, orderBy: { startedAt: "desc" }, take: 50, select: { startedAt: true } });
    const warning = runLimitWarning(runs, agent, new Date());
    if (warning) return { jobId: null, warning };
  }
  const jobId = await startJob(agentScanJob, { agentId: id, manual: true }, { key: agentJobKey(id) });
  revalidatePath("/agent");
  revalidatePath(`/agent/${id}`);
  return { jobId, warning: null };
});

const candidateId = z.string().min(1).max(100);

/** Every screen an agent draft shows on, or leaves. */
function revalidateAgent() {
  revalidatePath("/agent", "layout");
  revalidatePath("/applications");
  revalidatePath("/jobs");
  revalidatePath("/");
}

/**
 * Prepare draft (E16-5): writes a candidate's draft in the background. A
 * draft under way is reused, and one already made is answered with.
 */
export const prepareAgentDraft = action(z.object({ candidateId }), async ({ candidateId }) => {
  const candidate = await prisma.agentCandidate.findUnique({ where: { id: candidateId }, select: { status: true, applicationId: true } });
  if (!candidate) throw new ActionError("That posting is no longer in the agent's queue.");
  if (candidate.status === AgentCandidateStatus.DRAFTED && candidate.applicationId) return { jobId: null, applicationId: candidate.applicationId };
  const [unfinished] = await findUnfinishedJobs(draftJobKey(candidateId));
  if (unfinished) return { jobId: unfinished.id, applicationId: null };
  if (candidate.status !== AgentCandidateStatus.SCORED) throw new ActionError("That posting is no longer waiting for a draft.");
  const jobId = await startJob(agentDraftJob, { candidateId }, { key: draftJobKey(candidateId) });
  revalidatePath("/agent", "layout");
  return { jobId, applicationId: null };
});

/** Approve (E16-5): the draft joins Applications as a Draft. Nothing is sent. */
export const approveAgentDraft = action(z.object({ candidateId }), async ({ candidateId }, { toast }) => {
  const applicationId = await approveCandidate(candidateId);
  revalidateAgent();
  toast("Added to Applications as a draft. Nothing has been sent.");
  return { applicationId };
});

/**
 * Dismiss (E16-5): the posting never comes back; its draft, if any, is
 * deleted. A posting dismissed before it had a draft can be put back.
 */
export const dismissAgentCandidate = action(z.object({ candidateId }), async ({ candidateId }) => {
  const { undo } = await dismissCandidate(candidateId);
  revalidateAgent();
  return { undo };
});

/** Undo on a dismissed posting's toast. */
export const restoreAgentCandidate = action(
  z.object({
    id: candidateId,
    place: z.string().max(500),
    remote: z.boolean().nullable(),
    salary: z.string().max(500),
    postedAt: z.coerce.date().nullable(),
    // Shown as a link again: only a web address.
    url: z.string().max(4000).transform(safeLink),
    via: z.string().max(500),
    description: z.string().max(200_000),
    complete: z.boolean(),
    reasons: z.array(z.string().max(500)).max(10).nullable(),
    redFlags: z.array(z.string().max(500)).max(10).nullable(),
  }),
  async (saved) => {
    await restoreCandidate(saved);
    revalidateAgent();
    return null;
  },
);
