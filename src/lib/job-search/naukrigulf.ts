import "server-only";

import { z } from "zod";

import type { JobSourceAdapter, RequestContext, SourceCredentials } from "./adapter";
import { jobSearchError } from "./errors";
import { call, filtersOf, given, naukriAuth, naukriRecommended, postingsOf, searchSchema, signedIn, type Job, type NaukriStatus } from "./naukri";
import { NAUKRIGULF_FILTER_GROUPS, safeLink, type FoundPosting, type SearchPage, type SearchQuery } from "./search";
import { plainText } from "./text";

// NaukriGulf, through the same NopeRi server (noperi-ts) as Naukri, under
// /api/gulf. NopeRi maps NaukriGulf's jobs to the shape it gives Naukri's,
// with the posted date as a date rather than a label. Searches don't need the
// sign-in; recommendations, a posting's whole text and the apply do. The
// countries it covers are in SOURCE_INFO.

type Credentials = SourceCredentials["NAUKRIGULF"];

const PAGE_SIZE = 20;

/** When a posting went up: NopeRi gives NaukriGulf's as an ISO date; null when it can't be read. */
function postedAt(value: string | null | undefined): string | null {
  const time = value ? Date.parse(value) : NaN;
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function postingFromGulfJob(job: Job): FoundPosting {
  return {
    source: "NAUKRIGULF",
    externalId: job.jobId.slice(0, 500),
    title: plainText(given(job.title)).slice(0, 500),
    company: plainText(given(job.company)).slice(0, 300),
    place: plainText(given(job.location)).slice(0, 300),
    remote: null,
    salary: plainText(given(job.salary)).slice(0, 200),
    postedAt: postedAt(job.postedDate),
    url: safeLink(job.applyLink).slice(0, 2000),
    via: "",
    description: plainText(job.description).slice(0, 100_000),
    complete: false,
  };
}

export function gulfSearchPath(query: SearchQuery, page: number): string {
  const params = new URLSearchParams({
    // NaukriGulf's search has no remote filter: the words do what they can, as with Naukri.
    keyword: query.remoteOnly ? `${query.keywords} remote` : query.keywords,
    page: String(page),
    resultsPerPage: String(PAGE_SIZE),
  });
  if (query.place) params.set("location", query.place);
  if (query.experience !== undefined) params.set("experience", String(query.experience));
  // "Posted within" has no plain parameter here; NaukriGulf's own Posted filter (freshness) does it.
  for (const [key, ids] of Object.entries(query.filters ?? {})) {
    if (key in NAUKRIGULF_FILTER_GROUPS) for (const id of ids) params.append(`filter.${key}`, id);
  }
  return `/api/gulf/jobs/search?${params}`;
}

async function searchPage(query: SearchQuery, credentials: Credentials, next: string | null, context: RequestContext = {}): Promise<SearchPage> {
  const page = next?.startsWith("page:") ? Math.max(1, Number(next.slice("page:".length)) || 1) : 1;
  const answer = await call("NAUKRIGULF", credentials, gulfSearchPath(query, page), context);
  const search = searchSchema.safeParse(answer);
  if (!search.success) throw jobSearchError("changed", "NAUKRIGULF", { detail: "/api/gulf/jobs/search: unexpected answer" });
  const postings = postingsOf(search.data.jobs, "/api/gulf/jobs/search", "NAUKRIGULF", postingFromGulfJob);
  const more = postings.length >= PAGE_SIZE ? `page:${page + 1}` : null;
  return page === 1 ? { postings, next: more, filters: filtersOf(search.data, NAUKRIGULF_FILTER_GROUPS) } : { postings, next: more };
}

/** The jobs NaukriGulf recommends for its signed-in user, from the cache when asked for in the last half hour. */
export function naukriGulfRecommended(credentials: Credentials, context: RequestContext = {}): Promise<FoundPosting[]> {
  return naukriRecommended(credentials, context, "NAUKRIGULF", postingFromGulfJob);
}

/** Whether NopeRi is signed in to NaukriGulf; `login` signs in with its own credentials, `token` adopts a browser's AT cookie. */
export function naukriGulfAuth(credentials: Credentials, step: "status" | "login" | { token: string }, context: RequestContext = {}): Promise<NaukriStatus> {
  return naukriAuth(credentials, step, context, "NAUKRIGULF");
}

const text = z.string().nullish().catch(null);
/**
 * NaukriGulf's own job details, as NopeRi passes them on. Only what Dossier
 * reads is checked; the text's field name differs between postings.
 */
const detailsSchema = z.object({
  Job: z
    .object({
      Description: text,
      JobDescription: text,
      jobDescription: text,
      jobInfo: text,
      Other: z.object({ IsApplied: z.union([z.boolean(), z.string()]).nullish().catch(null) }).nullish().catch(null),
    })
    ,
});

export const naukriGulf: JobSourceAdapter<"NAUKRIGULF"> = {
  source: "NAUKRIGULF",
  search: searchPage,
  details: async (posting, credentials, context) => {
    const answer = detailsSchema.safeParse(await signedIn("NAUKRIGULF", credentials, `/api/gulf/jobs/${encodeURIComponent(posting.externalId)}`, context));
    if (!answer.success) return null;
    const job = answer.data.Job;
    return plainText(job.Description || job.JobDescription || job.jobDescription || job.jobInfo).slice(0, 100_000) || null;
  },
  test: async (credentials, context) => {
    await naukriGulfAuth(credentials, "status", context);
  },
};

// Easy apply through NopeRi (src/lib/jobs/naukrigulf-apply.ts). NopeRi's
// NaukriGulf apply sends no resume and answers no questions: the profile's own
// resume goes, and a job that asks more is finished on naukrigulf.com.

const applySchema = z.object({
  applied: z.boolean(),
  alreadyApplied: z.boolean().nullish().catch(null),
  status: z.number().nullish().catch(null),
  layerCode: z.union([z.string(), z.number()]).nullish().catch(null),
  message: z.string().nullish().catch(null),
  result: z.object({ status: z.number().nullish().catch(null), message: z.string().nullish().catch(null) }).nullish().catch(null),
});

export type NaukriGulfApplied = {
  applied: boolean;
  alreadyApplied: boolean;
  /** The apply goes on on the company's own site (NaukriGulf's 307). */
  companySite: boolean;
  /** NaukriGulf wants another step first (a questionnaire, a gap in the profile): its 400, with what it said. */
  needsMore: boolean;
  status: number | null;
  message: string | null;
};

/** Applies on NaukriGulf with the profile's resume. `applied` is NaukriGulf's own confirmation. */
export async function naukriGulfApply(credentials: Credentials, jobId: string, context: RequestContext = {}): Promise<NaukriGulfApplied> {
  const path = `/api/gulf/jobs/${encodeURIComponent(jobId)}/apply`;
  const answer = applySchema.safeParse(await signedIn("NAUKRIGULF", credentials, path, context, { source: "self" }));
  if (!answer.success) throw jobSearchError("changed", "NAUKRIGULF", { detail: `${path}: unexpected answer` });
  const { applied, alreadyApplied, status, layerCode, message, result } = answer.data;
  return {
    applied,
    alreadyApplied: alreadyApplied === true,
    companySite: !applied && result?.status === 307,
    needsMore: !applied && (status === 400 || layerCode != null),
    status: status ?? null,
    message: message ?? result?.message ?? null,
  };
}

const historySchema = z.object({ jobs: z.array(z.object({ jobId: z.union([z.string(), z.number()]).transform(String) })).catch([]) });

/** Leading zeros aside: NaukriGulf writes the same job's id with and without them. */
const sameId = (a: string, b: string) => a.replace(/^0+/, "") === b.replace(/^0+/, "");

/** Whether NaukriGulf's easy-apply history lists the job: the check when an apply isn't confirmed (it may have gone through earlier). */
export async function naukriGulfHasApplied(credentials: Credentials, jobId: string, context: RequestContext = {}): Promise<boolean> {
  const path = "/api/gulf/applications?type=easy&limit=50";
  const answer = historySchema.safeParse(await signedIn("NAUKRIGULF", credentials, path, context));
  if (!answer.success) throw jobSearchError("changed", "NAUKRIGULF", { detail: `${path}: unexpected answer` });
  return answer.data.jobs.some((job) => sameId(job.jobId, jobId));
}
