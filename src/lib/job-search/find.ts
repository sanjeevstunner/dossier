import "server-only";

import { withStates } from "@/lib/postings";

import { credentialsFor, loadJobSearchConfig, requestContext } from "./config";
import { JobSearchError } from "./errors";
import { postingDetails, searchPostings, type PostingDetails } from "./index";
import { naukriAuth, naukriRecommended, type NaukriStatus } from "./naukri";
import type { FoundPosting, JobSource, SearchPage, SearchProblem, SearchQuery, ShownPosting } from "./search";

// Asking a job source from Find jobs (E14-6): a page of postings, or what
// went wrong in words for the screen. Kept searches are in
// src/lib/posting-searches.ts.

/**
 * One page for `query` from `source`, the one chosen in Settings unless
 * given (a kept search goes on with the source it ran on).
 */
export async function askSource(
  query: SearchQuery,
  { source, next = null }: { source?: JobSource; next?: string | null } = {},
): Promise<({ ok: true; source: JobSource } & SearchPage) | SearchProblem> {
  const config = await loadJobSearchConfig();
  const from = source ?? config.source;
  if (!from) return { ok: false, problem: "off", message: "Choose where to search in Settings → Job search first." };
  if (!query.country) return { ok: false, problem: "no-country", message: "Choose a country to search in." };
  return asProblem(async () => {
    const page = await searchPostings(from, credentialsFor(config, from), query, next, requestContext(from));
    return { ok: true as const, source: from, ...page };
  });
}

/** `work`'s answer, or a JobSearchError as what went wrong for the screen. */
async function asProblem<T>(work: () => Promise<T>): Promise<T | SearchProblem> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof JobSearchError) return { ok: false, problem: error.problem, message: error.message };
    throw error;
  }
}

/** The jobs Naukri recommends, as Find jobs shows them, or what went wrong ("login" until NopeRi is signed in). */
export async function recommendedPostings(): Promise<{ ok: true; postings: ShownPosting[] } | SearchProblem> {
  const config = await loadJobSearchConfig();
  return asProblem(async () => ({
    ok: true as const,
    postings: await withStates(await naukriRecommended(credentialsFor(config, "NAUKRI"), requestContext("NAUKRI"))),
  }));
}

/** NopeRi's Naukri sign-in: its status, a sign-in with its own credentials, or a browser's token. */
export async function naukriSignIn(step: "status" | "login" | { token: string }): Promise<({ ok: true } & NaukriStatus) | SearchProblem> {
  const config = await loadJobSearchConfig();
  return asProblem(async () => ({ ok: true as const, ...(await naukriAuth(credentialsFor(config, "NAUKRI"), step, requestContext("NAUKRI"))) }));
}

/**
 * The whole text of a posting, from its own source (which may no longer be
 * the one chosen, for a saved posting); null when it can't be had.
 */
export async function fullText(posting: FoundPosting): Promise<string | null> {
  return (await fullPosting(posting)).text;
}

/** fullText, with the external apply link when the source gives one. */
export async function fullPosting(posting: FoundPosting): Promise<PostingDetails> {
  if (posting.complete) return { text: posting.description };
  try {
    return await postingDetails(posting.source, credentialsFor(await loadJobSearchConfig(), posting.source), posting, requestContext(posting.source));
  } catch (error) {
    if (error instanceof JobSearchError) return { text: null };
    throw error;
  }
}
