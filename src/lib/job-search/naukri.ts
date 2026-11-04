import "server-only";

import { z } from "zod";

import type { JobSourceAdapter, RequestContext, SourceCredentials } from "./adapter";
import { cached, remember } from "./cache";
import { JobSearchError, jobSearchError } from "./errors";
import { requestJson } from "./http";
import { POSTED_WITHIN, safeLink, type FoundPosting, type SearchPage, type SearchQuery } from "./search";
import { plainText } from "./text";

// Naukri, through the user's own NopeRi server (noperi-ts), which holds the
// Naukri sign-in and reaches it like a browser. Searches don't need the
// sign-in; recommendations and a posting's whole text do. The countries it
// covers are in SOURCE_INFO.

type Credentials = SourceCredentials["NAUKRI"];

const PAGE_SIZE = 20;

const text = z.string().nullish().catch(null);
const jobSchema = z.object({
  jobId: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1)),
  title: text,
  company: text,
  location: text,
  salary: text,
  postedDate: text,
  applyLink: text,
  description: text,
});
type Job = z.output<typeof jobSchema>;

const statusSchema = z.object({ loggedIn: z.boolean(), loginTime: z.string().nullable().catch(null) });
export type NaukriStatus = z.output<typeof statusSchema>;

/** NopeRi's placeholders for a field Naukri left out. */
const given = (value: string | null | undefined) => (value && value !== "N/A" && value !== "Not disclosed" ? value : "");

/** When a posting went up, from Naukri's label ("Today", "3 Days Ago", "30+ Days Ago"); null when it can't be read. */
export function postedAtFromLabel(label: string | null | undefined, now = new Date()): string | null {
  const value = (label ?? "").trim().toLowerCase();
  if (/^(just now|today|few hours ago|\d+ hours? ago)$/.test(value)) return now.toISOString();
  const days = /^(\d+)\+? days? ago$/.exec(value);
  return days ? new Date(now.getTime() - Number(days[1]) * 86_400_000).toISOString() : null;
}

export function postingFromJob(job: Job, now = new Date()): FoundPosting {
  return {
    source: "NAUKRI",
    externalId: job.jobId.slice(0, 500),
    title: plainText(given(job.title)).slice(0, 500),
    company: plainText(given(job.company)).slice(0, 300),
    place: plainText(given(job.location)).slice(0, 300),
    remote: null,
    salary: plainText(given(job.salary)).slice(0, 200),
    postedAt: postedAtFromLabel(job.postedDate, now),
    url: safeLink(job.applyLink).slice(0, 2000),
    via: "",
    description: plainText(job.description).slice(0, 100_000),
    complete: false,
  };
}

/** A request to NopeRi, with its API key. */
function call(credentials: Credentials, path: string, context: RequestContext = {}, json?: unknown): Promise<unknown> {
  const url = new URL(`${(context.baseUrl ?? credentials.url).replace(/\/+$/, "")}${path}`);
  return requestJson("NAUKRI", url, { headers: { "x-api-key": credentials.apiKey }, signal: context.signal, json });
}

/**
 * A request that needs, or makes, the Naukri sign-in. NopeRi answers 401 both for a
 * wrong API key and for a sign-in that's missing or expired; its status,
 * which needs only the key, tells them apart.
 */
async function signedIn(credentials: Credentials, path: string, context: RequestContext = {}, json?: unknown): Promise<unknown> {
  try {
    return await call(credentials, path, context, json);
  } catch (error) {
    if (!(error instanceof JobSearchError) || error.problem !== "key") throw error;
    await call(credentials, "/api/auth/status", context);
    throw jobSearchError("login", "NAUKRI", { detail: `${path}: not signed in` });
  }
}

/** Naukri's jobs from an answer, as postings; unreadable ones are left out. */
function postingsOf(answer: unknown, path: string): FoundPosting[] {
  if (!Array.isArray(answer)) throw jobSearchError("changed", "NAUKRI", { detail: `${path}: unexpected answer` });
  const seen = new Set<string>();
  return answer.flatMap((item) => {
    const job = jobSchema.safeParse(item);
    if (!job.success || seen.has(job.data.jobId)) return [];
    seen.add(job.data.jobId);
    return [postingFromJob(job.data)];
  });
}

export function searchPath(query: SearchQuery, page: number): string {
  const params = new URLSearchParams({
    // Naukri's search has no remote filter here: the words do what they can, as with Adzuna.
    keyword: query.remoteOnly ? `${query.keywords} remote` : query.keywords,
    page: String(page),
    resultsPerPage: String(PAGE_SIZE),
  });
  if (query.place) params.set("location", query.place);
  const days = POSTED_WITHIN.find((option) => option.value === query.postedWithin)?.days;
  if (days) params.set("jobAge", String(days));
  if (query.experience !== undefined) params.set("experience", String(query.experience));
  return `/api/jobs/search?${params}`;
}

async function searchPage(query: SearchQuery, credentials: Credentials, next: string | null, context: RequestContext = {}): Promise<SearchPage> {
  const page = next?.startsWith("page:") ? Math.max(1, Number(next.slice("page:".length)) || 1) : 1;
  const path = searchPath(query, page);
  const postings = postingsOf(await call(credentials, path, context), "/api/jobs/search");
  return { postings, next: postings.length >= PAGE_SIZE ? `page:${page + 1}` : null };
}

/** The jobs Naukri recommends for its signed-in user, from the cache when asked for in the last half hour. */
export async function naukriRecommended(credentials: Credentials, context: RequestContext = {}): Promise<FoundPosting[]> {
  const key = "recommended:NAUKRI";
  const hit = cached<FoundPosting[]>(key);
  if (hit) return hit;
  const postings = postingsOf(await signedIn(credentials, "/api/jobs/recommended", context), "/api/jobs/recommended");
  remember(key, postings);
  return postings;
}

/** Whether NopeRi is signed in to Naukri; `login` signs in with its own credentials, `token` adopts a browser's nauk_at cookie. */
export async function naukriAuth(credentials: Credentials, step: "status" | "login" | { token: string }, context: RequestContext = {}): Promise<NaukriStatus> {
  const answer =
    step === "status"
      ? await call(credentials, "/api/auth/status", context)
      : step === "login"
        ? await signedIn(credentials, "/api/auth/login", context, {})
        : await signedIn(credentials, "/api/auth/token", context, { token: step.token });
  const status = statusSchema.safeParse(answer);
  if (!status.success) throw jobSearchError("changed", "NAUKRI", { detail: "/api/auth: unexpected answer" });
  return status.data;
}

const detailsSchema = z.object({ details: z.object({ jobDetails: z.object({ description: text }).nullish().catch(null) }).nullish().catch(null) });

export const naukri: JobSourceAdapter<"NAUKRI"> = {
  source: "NAUKRI",
  search: searchPage,
  details: async (posting, credentials, context) => {
    const answer = detailsSchema.safeParse(await signedIn(credentials, `/api/jobs/${encodeURIComponent(posting.externalId)}`, context));
    return (answer.success && plainText(answer.data.details?.jobDetails?.description)) || null;
  },
  test: async (credentials, context) => {
    await naukriAuth(credentials, "status", context);
  },
};
