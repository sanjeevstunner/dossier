import "server-only";

import { z } from "zod";

import { fetchPosting } from "@/lib/posting-fetch";

import type { JobSourceAdapter, RequestContext, SourceCredentials } from "./adapter";
import { cached, remember } from "./cache";
import { JobSearchError, jobSearchError } from "./errors";
import { requestJson } from "./http";
import { NAUKRI_FILTER_GROUPS, POSTED_WITHIN, safeLink, type FoundPosting, type SearchFilters, type SearchPage, type SearchQuery } from "./search";
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

const optionSchema = z.object({ id: z.string().min(1).max(40), count: z.number().int().min(0), label: z.string().max(200) });
/** NopeRi's search answer: its jobs and Naukri's filter groups (older NopeRi answers a bare list of jobs). */
const searchSchema = z.object({
  jobs: z.array(z.unknown()),
  total: z.number().int().min(0).catch(0),
  clusters: z.record(z.string(), z.array(optionSchema).catch([])).catch({}),
  clusterOrder: z.array(z.string()).catch([]),
});

/** The groups Dossier knows, in Naukri's order, with the ones it left out of that order last. */
export function filtersOf(answer: z.output<typeof searchSchema>): SearchFilters {
  const keys = [...new Set([...answer.clusterOrder, ...Object.keys(NAUKRI_FILTER_GROUPS)])];
  const groups = keys.flatMap((key) => (key in NAUKRI_FILTER_GROUPS && answer.clusters[key]?.length ? [{ key, options: answer.clusters[key] }] : []));
  return { total: answer.total, groups };
}

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
  for (const [key, ids] of Object.entries(query.filters ?? {})) for (const id of ids) params.append(`filter.${key}`, id);
  return `/api/jobs/search?${params}`;
}

async function searchPage(query: SearchQuery, credentials: Credentials, next: string | null, context: RequestContext = {}): Promise<SearchPage> {
  const page = next?.startsWith("page:") ? Math.max(1, Number(next.slice("page:".length)) || 1) : 1;
  const path = searchPath(query, page);
  const answer = await call(credentials, path, context);
  const search = searchSchema.safeParse(answer);
  const postings = postingsOf(search.success ? search.data.jobs : answer, "/api/jobs/search");
  const more = postings.length >= PAGE_SIZE ? `page:${page + 1}` : null;
  return search.success && page === 1 ? { postings, next: more, filters: filtersOf(search.data) } : { postings, next: more };
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

const detailsSchema = z.object({
  externalApply: z.boolean().catch(false),
  details: z
    .object({ jobDetails: z.object({ description: text, applyRedirectUrl: text, companyApplyUrl: text }).nullish().catch(null) })
    .nullish()
    .catch(null),
});

export const naukri: JobSourceAdapter<"NAUKRI"> = {
  source: "NAUKRI",
  search: searchPage,
  details: async (posting, credentials, context) => {
    const answer = detailsSchema.safeParse(await signedIn(credentials, `/api/jobs/${encodeURIComponent(posting.externalId)}`, context));
    if (!answer.success) return null;
    const job = answer.data.details?.jobDetails;
    const text = plainText(job?.description) || null;
    // Company-site jobs: Naukri hands the applicant over to this link; the rest are Naukri's own Apply.
    const applyUrl = answer.data.externalApply ? safeLink(job?.applyRedirectUrl || job?.companyApplyUrl).slice(0, 2000) : "";
    if (!applyUrl) return text;
    // The company's own page often says more (or differs); read it like "Fetch" does (E7-8), and keep Naukri's text when it can't be read.
    const page = await fetchPosting(applyUrl);
    const site = page.ok ? page.text.trim() : "";
    const whole = site && site !== text ? [text, `From the company site:\n${site}`].filter(Boolean).join("\n\n") : text;
    return { text: whole?.slice(0, 100_000) ?? null, applyUrl };
  },
  test: async (credentials, context) => {
    await naukriAuth(credentials, "status", context);
  },
};

// Easy apply through NopeRi (the apply agent, src/lib/jobs/easy-apply.ts).

const skillsSchema = z.object({ mandatory: z.array(z.string()).catch([]), optional: z.array(z.string()).catch([]) });
const applyInfoSchema = z.object({ externalApply: z.boolean(), skills: skillsSchema.catch({ mandatory: [], optional: [] }) });
export type NaukriSkills = z.output<typeof skillsSchema>;

/** Whether a Naukri job applies on the company site, and the skills its apply sends. */
export async function naukriApplyInfo(credentials: Credentials, jobId: string, context: RequestContext = {}): Promise<z.output<typeof applyInfoSchema>> {
  const path = `/api/jobs/${encodeURIComponent(jobId)}`;
  const answer = applyInfoSchema.safeParse(await signedIn(credentials, path, context));
  if (!answer.success) throw jobSearchError("changed", "NAUKRI", { detail: `${path}: unexpected answer` });
  return answer.data;
}

export const questionSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  type: z.enum(["text", "choice", "multi"]),
  /** Option key → label; the answer sends labels. */
  options: z.record(z.string(), z.string()),
  required: z.boolean().catch(true),
  /** Naukri fills it from the Naukri profile (CTC, notice period…), so it's left out of the answers. */
  skippable: z.boolean().catch(false),
  prefill: z.array(z.string()).catch([]),
});
export type NaukriQuestion = z.output<typeof questionSchema>;
/** Text answers as strings, choice answers as lists of option labels, keyed by question id. */
export type NaukriAnswers = Record<string, string | string[]>;

const applySchema = z.object({
  applied: z.boolean(),
  status: z.number().nullish().catch(null),
  message: z.string().nullish().catch(null),
  sid: z.string(),
  questionnaireRequired: z.boolean(),
  questionnaire: z.array(questionSchema).catch([]),
});
/** A resume PDF to apply with: NopeRi puts it on the Naukri profile for the apply, then puts the profile's own back. */
export type NaukriResume = { data: Uint8Array; name: string };
export type NaukriApplied = { applied: boolean; status: number | null; message: string | null; sid: string; questionnaire: NaukriQuestion[] };

/**
 * Applies on Naukri. `applied` is Naukri's own confirmation; a questionnaire
 * means it wasn't sent yet: apply again with the same `sid` and `answers`.
 */
export async function naukriApply(
  credentials: Credentials,
  jobId: string,
  { skills, sid, answers, resume }: { skills: NaukriSkills; sid?: string; answers?: NaukriAnswers; resume?: NaukriResume },
  context: RequestContext = {},
): Promise<NaukriApplied> {
  const path = `/api/jobs/${encodeURIComponent(jobId)}/apply`;
  const body = { source: "search", mandatorySkills: skills.mandatory, optionalSkills: skills.optional, ...(sid && { sid }), ...(answers && { answers }) };
  const answer = applySchema.safeParse(await signedIn(credentials, path, context, resume ? applyForm(body, resume) : body));
  if (!answer.success) throw jobSearchError("changed", "NAUKRI", { detail: `${path}: unexpected answer` });
  const { applied, status, message, questionnaireRequired, questionnaire } = answer.data;
  return { applied, status: status ?? null, message: message ?? null, sid: answer.data.sid, questionnaire: questionnaireRequired ? questionnaire : [] };
}

/** NopeRi's multipart apply: the resume in `resume`, the apply itself as JSON in `data`. */
function applyForm(body: object, resume: NaukriResume): FormData {
  const form = new FormData();
  form.append("resume", new Blob([Buffer.from(resume.data)], { type: "application/pdf" }), resume.name);
  form.append("data", JSON.stringify(body));
  return form;
}

/** Whether Naukri's history lists the job as applied: the check when an apply isn't confirmed (it may have gone through earlier). */
export async function naukriHasApplied(credentials: Credentials, jobId: string, context: RequestContext = {}): Promise<boolean> {
  const answer = await signedIn(credentials, "/api/applications?pageSize=50&days=30", context);
  if (!Array.isArray(answer)) throw jobSearchError("changed", "NAUKRI", { detail: "/api/applications: unexpected answer" });
  return answer.some((item) => item && typeof item === "object" && "jobId" in item && String(item.jobId) === jobId);
}
