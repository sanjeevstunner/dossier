import "server-only";

import type { AgentCandidate } from "@/generated/prisma/client";
import { AgentCandidateStatus, AgentRunStatus, JobStatus } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/dates";
import { loadJobSearchConfig } from "@/lib/job-search/config";
import { countryName } from "@/lib/job-search/countries";
import { describeSearch, postedAgo, type JobSource, type SearchQuery } from "@/lib/job-search/search";
import { SOURCE_INFO } from "@/lib/job-search/sources";
import { prisma } from "@/lib/prisma";
import { lastKnownTimeZone } from "@/lib/time-zone";

import { listAgents, loadAgent, type AgentConfig } from "./agents";
import { stringsOf } from "./candidates";
import { agentJobKey } from "./jobs";
import { agentSetupProblem, agentSource } from "./run";
import { runLimitWarning } from "./runs";
import { nextAgentRun, scheduleText } from "./schedule";

// What the Agents screens show (E16-6): the list of agents, and one agent's
// config, runs with their logs, and what's waiting for a look.

export type AgentCandidateView = {
  id: string;
  title: string;
  company: string;
  /** "Rotterdam · Remote · €70k", what's known of them. */
  facts: string;
  /** "Posted 2 days ago · via LinkedIn on JSearch". */
  origin: string;
  source: JobSource;
  url: string;
  score: number;
  reasons: string[];
  redFlags: string[];
  /** Why the last try at a draft failed. */
  error: string | null;
  /** The draft, once there is one. */
  applicationId: string | null;
  /** The job preparing its draft, while one is queued or running. */
  draftJobId: string | null;
};

export type RunStatus = "RUNNING" | "DONE" | "FAILED";

export type AgentRunSummary = { id: string; at: string; manual: boolean; status: RunStatus; message: string | null };

export type AgentRunDetail = AgentRunSummary & {
  finishedAt: string | null;
  counts: { found: number; fresh: number; scored: number; drafted: number; skipped: number };
  steps: { at: string; text: string }[];
  /** The postings it scored, and where each stands now. */
  postings: { id: string; title: string; company: string; score: number; state: string }[];
};

export type AgentCardView = {
  id: string;
  name: string;
  enabled: boolean;
  search: string | null;
  schedule: string;
  nextRun: string | null;
  lastRun: AgentRunSummary | null;
  waiting: number;
  runJobId: string | null;
  setupProblem: string | null;
};

export type AgentEditable = Pick<
  AgentConfig,
  "name" | "enabled" | "query" | "source" | "hour" | "days" | "minScore" | "maxScores" | "maxDrafts" | "autoDraft" | "maxRunsPerDay" | "manualIntervalMinutes"
>;

export type AgentDetailView = {
  id: string;
  config: AgentEditable;
  /** Every agent, for the switcher. */
  agents: { id: string; name: string; enabled: boolean }[];
  search: string | null;
  schedule: string;
  setupProblem: string | null;
  /** Which settings section fixes it, or null when this agent's config does. */
  setupSection: "ai" | "jobs" | null;
  /** Run now would be past this agent's limits; a warning only. */
  limitWarning: string | null;
  nextRun: string | null;
  runJobId: string | null;
  runs: AgentRunSummary[];
  /** The run picked in History, with its log. */
  run: AgentRunDetail | null;
  drafts: AgentCandidateView[];
  /** At or above the minimum score, best first. */
  scored: AgentCandidateView[];
  /** Below it: kept so they don't come back, shown on request. */
  belowMinimum: AgentCandidateView[];
  /** The board in Settings → Job search, which an agent without its own searches. */
  defaultSource: JobSource | null;
  timeZone: string;
};

/** "Today" and "Yesterday" in a sentence; "2 days ago" or "15 Oct" as they are. */
const posted = (ago: string) => (ago === "Today" || ago === "Yesterday" ? ago.toLowerCase() : ago);

const candidateView = (candidate: AgentCandidate, now: Date, draftJob: ReadonlyMap<string, string>): AgentCandidateView => ({
  id: candidate.id,
  title: candidate.title.trim() || "Untitled posting",
  company: candidate.company.trim(),
  facts: [candidate.place, candidate.remote ? "Remote" : "", candidate.salary].filter(Boolean).join(" · "),
  origin: [
    candidate.postedAt ? `Posted ${posted(postedAgo(candidate.postedAt.toISOString(), now))}` : "",
    [candidate.via ? `via ${candidate.via}` : "", `on ${SOURCE_INFO[candidate.source].name}`].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" · "),
  source: candidate.source,
  url: candidate.url,
  score: candidate.score,
  reasons: stringsOf(candidate.reasons),
  redFlags: stringsOf(candidate.redFlags),
  error: candidate.error,
  applicationId: candidate.applicationId,
  draftJobId: draftJob.get(candidate.id) ?? null,
});

const sectionOf = (problem: string): AgentDetailView["setupSection"] =>
  problem.includes("AI provider") ? "ai" : problem.includes("Job search") ? "jobs" : null;

/** "Data scientist in Berlin (25 km), Germany · via JSearch", or null without a search. */
const searchText = (query: SearchQuery, source: JobSource | null) =>
  query.keywords.trim() ? `${describeSearch(query, countryName(query.country) || query.country.toUpperCase())}${source ? ` · via ${SOURCE_INFO[source].name}` : ""}` : null;

/** What's waiting for a look: scored at or above the minimum, and drafts. */
const waitingWhere = (agent: Pick<AgentConfig, "id" | "minScore">) => ({
  agentId: agent.id,
  OR: [
    { status: AgentCandidateStatus.SCORED, score: { gte: agent.minScore } },
    { status: AgentCandidateStatus.DRAFTED, applicationId: { not: null } },
  ],
});

/** The Agents item's badge (E16-6): what's waiting for a look, across agents. */
export async function countAgentQueue(): Promise<number> {
  const counts = await Promise.all((await listAgents()).map((agent) => prisma.agentCandidate.count({ where: waitingWhere(agent) })));
  return counts.reduce((sum, count) => sum + count, 0);
}

const summary = (run: { id: string; startedAt: Date; manual: boolean; status: AgentRunStatus; message: string | null }, timeZone: string, now: Date): AgentRunSummary => ({
  id: run.id,
  at: formatDateTime(run.startedAt, timeZone, now),
  manual: run.manual,
  status: run.status,
  message: run.message,
});

const runningJobs = async (agentIds: string[]) =>
  new Map(
    (
      await prisma.job.findMany({ where: { key: { in: agentIds.map(agentJobKey) }, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, select: { id: true, key: true } })
    ).map((job) => [job.key, job.id]),
  );

/** The Agents screen: one card per agent. */
export async function loadAgentList(now = new Date()): Promise<AgentCardView[]> {
  const [agents, config, timeZone] = await Promise.all([listAgents(), loadJobSearchConfig(), lastKnownTimeZone()]);
  const jobs = await runningJobs(agents.map((agent) => agent.id));
  return Promise.all(
    agents.map(async (agent) => {
      const [runs, waiting, setupProblem] = await Promise.all([
        prisma.agentRun.findMany({ where: { agentId: agent.id }, orderBy: { startedAt: "desc" }, take: 5 }),
        prisma.agentCandidate.count({ where: waitingWhere(agent) }),
        agentSetupProblem(agent),
      ]);
      const next = agent.enabled ? nextAgentRun(now, agent, timeZone, runs) : null;
      return {
        id: agent.id,
        name: agent.name,
        enabled: agent.enabled,
        search: searchText(agent.query, agentSource(agent, config)),
        schedule: scheduleText(agent),
        nextRun: next && formatDateTime(next, timeZone, now),
        lastRun: runs[0] ? summary(runs[0], timeZone, now) : null,
        waiting,
        runJobId: jobs.get(agentJobKey(agent.id)) ?? null,
        setupProblem,
      };
    }),
  );
}

const STATE: Record<AgentCandidateStatus, string> = {
  SCORED: "Waiting",
  DRAFTING: "Drafting",
  DRAFTED: "Draft ready",
  APPROVED: "Approved",
  DISMISSED: "Dismissed",
};

/** One agent: its config, runs (with the one picked, `runId`, or the latest), and its queue. Null when there's no such agent. */
export async function loadAgentDetail(id: string, runId?: string, now = new Date()): Promise<AgentDetailView | null> {
  const agent = await loadAgent(id);
  if (!agent) return null;
  const [all, config, timeZone, candidates, draftJobs, jobs, runs] = await Promise.all([
    listAgents(),
    loadJobSearchConfig(),
    lastKnownTimeZone(),
    prisma.agentCandidate.findMany({
      where: { agentId: id, status: { in: [AgentCandidateStatus.SCORED, AgentCandidateStatus.DRAFTING, AgentCandidateStatus.DRAFTED] } },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    }),
    prisma.job.findMany({ where: { type: "agent-draft", status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, select: { id: true, key: true } }),
    runningJobs([id]),
    prisma.agentRun.findMany({ where: { agentId: id }, orderBy: { startedAt: "desc" }, take: 50 }),
  ]);
  const draftJob = new Map(draftJobs.flatMap((job) => (job.key ? [[job.key.replace(/^agent-candidate:/, ""), job.id] as const] : [])));
  const view = (candidate: AgentCandidate) => candidateView(candidate, now, draftJob);

  const picked = runs.find((run) => run.id === runId) ?? runs[0];
  let run: AgentRunDetail | null = null;
  if (picked) {
    const postings = await prisma.agentCandidate.findMany({ where: { runId: picked.id }, orderBy: { score: "desc" }, select: { id: true, title: true, company: true, score: true, status: true } });
    const steps = Array.isArray(picked.steps) ? picked.steps : [];
    run = {
      ...summary(picked, timeZone, now),
      finishedAt: picked.finishedAt && formatDateTime(picked.finishedAt, timeZone, now),
      counts: { found: picked.found, fresh: picked.fresh, scored: picked.scored, drafted: picked.drafted, skipped: picked.skipped },
      steps: steps.flatMap((entry) =>
        entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.text === "string" && typeof entry.at === "string"
          ? [{ at: formatDateTime(new Date(entry.at), timeZone, now), text: entry.text }]
          : [],
      ),
      postings: postings.map((posting) => ({
        id: posting.id,
        title: posting.title.trim() || "Untitled posting",
        company: posting.company.trim(),
        score: posting.score,
        state: posting.status === AgentCandidateStatus.SCORED && posting.score < agent.minScore ? "Below minimum" : STATE[posting.status],
      })),
    };
  }

  const setupProblem = await agentSetupProblem(agent);
  const next = agent.enabled ? nextAgentRun(now, agent, timeZone, runs) : null;
  const drafts = candidates.filter((candidate) => candidate.status === AgentCandidateStatus.DRAFTED && candidate.applicationId).map(view);
  const waiting = candidates.filter((candidate) => candidate.status !== AgentCandidateStatus.DRAFTED);
  const { name, enabled, query, source, hour, days, minScore, maxScores, maxDrafts, autoDraft, maxRunsPerDay, manualIntervalMinutes } = agent;

  return {
    id,
    config: { name, enabled, query, source, hour, days, minScore, maxScores, maxDrafts, autoDraft, maxRunsPerDay, manualIntervalMinutes },
    agents: all.map((entry) => ({ id: entry.id, name: entry.name, enabled: entry.enabled })),
    search: searchText(query, agentSource(agent, config)),
    schedule: scheduleText(agent),
    setupProblem,
    setupSection: setupProblem ? sectionOf(setupProblem) : null,
    limitWarning: runLimitWarning(runs, agent, now),
    nextRun: next && formatDateTime(next, timeZone, now),
    runJobId: jobs.get(agentJobKey(id)) ?? null,
    runs: runs.map((entry) => summary(entry, timeZone, now)),
    run,
    drafts,
    scored: waiting.filter((candidate) => candidate.score >= minScore).map(view),
    belowMinimum: waiting.filter((candidate) => candidate.score < minScore).map(view),
    defaultSource: config.source,
    timeZone,
  };
}
