"use server";

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { getAiProvider } from "@/lib/ai";
import { isAiConfigured } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { tailorNaukriProfile } from "@/lib/ai/tasks";
import { credentialsFor, loadJobSearchConfig, requestContext } from "@/lib/job-search/config";
import { JobSearchError } from "@/lib/job-search/errors";
import { naukriEditableProfile, naukriLookup, naukriUpdateProfile } from "@/lib/job-search/naukri";
import { LOCATIONS_MAX, NOTICE_PERIODS, updateSchema, type NaukriTag, type Suggestion } from "@/lib/naukri-profile";
import { loadProfile } from "@/lib/profile-data";

/** NopeRi's Naukri credentials, or the reason there are none as an ActionError. */
async function naukri<T>(work: (credentials: ReturnType<typeof credentialsFor<"NAUKRI">>, context: ReturnType<typeof requestContext>) => Promise<T>): Promise<T> {
  try {
    return await work(credentialsFor(await loadJobSearchConfig(), "NAUKRI"), requestContext("NAUKRI"));
  } catch (error) {
    if (error instanceof JobSearchError) throw new ActionError(error.message);
    throw error;
  }
}

/** Each name as Naukri's tag: the exact match (any case) when there is one, else its best guess; names it doesn't know come back apart. */
async function resolve(type: "location" | "designation", names: string[]): Promise<{ tags: NaukriTag[]; unresolved: string[] }> {
  const found = await naukri((credentials, context) => Promise.all(names.map((name) => naukriLookup(credentials, type, name, context))));
  const tags: NaukriTag[] = [];
  const unresolved: string[] = [];
  names.forEach((name, index) => {
    const options = found[index];
    const tag = options.find((option) => option.name.toLowerCase() === name.toLowerCase()) ?? options[0];
    if (!tag) unresolved.push(name);
    else if (!tags.some((kept) => kept.id === tag.id)) tags.push(tag);
  });
  return { tags, unresolved };
}

const target = z.object({
  role: z.string().trim().min(2, "Name the role you're after.").max(150),
  locations: z.array(z.string().trim().min(2).max(100)).max(LOCATIONS_MAX),
  salary: z.number().int().positive().max(1_000_000_000).nullable(),
  noticePeriodId: z.number().int().refine((id) => NOTICE_PERIODS.some((period) => period.id === id)).nullable(),
  notes: z.string().trim().max(2000),
});

/** Suggests the whole Naukri profile for a target role: the AI writes the words, the form gives locations, salary and notice period. */
export const suggestNaukriProfile = action(target, async ({ role, locations, salary, noticePeriodId, notes }): Promise<Suggestion> => {
  if (!(await isAiConfigured())) throw new ActionError("Choose an AI provider in Settings → AI provider first.");
  const [current, profile, provider, options] = await Promise.all([
    naukri(naukriEditableProfile),
    loadProfile(),
    getAiProvider(),
    loadTaskOptions(),
  ]);
  const { data } = await tailorNaukriProfile(provider, { role, notes, current, profile }, options);
  const [roles, places] = await Promise.all([resolve("designation", data.desiredRoles), resolve("location", locations)]);
  return {
    headline: data.headline || current.headline,
    summary: data.summary || current.summary,
    keySkills: data.keySkills.length ? data.keySkills : current.keySkills,
    desiredRoles: roles.tags.length ? roles.tags : current.desiredRoles,
    preferredLocations: locations.length ? places.tags : current.preferredLocations,
    expectedSalary: salary ? { amount: salary, currency: current.expectedSalary?.currency ?? "INR" } : current.expectedSalary,
    noticePeriodId: noticePeriodId ?? current.noticePeriodId,
    reasons: data.reasons,
    unresolved: [...roles.unresolved, ...places.unresolved],
  };
});

/** Naukri's tag for a city or role typed on the screen. */
export const lookUpNaukriTag = action(z.object({ type: z.enum(["location", "designation"]), name: z.string().trim().min(2).max(100) }), async ({ type, name }) => {
  const { tags } = await resolve(type, [name]);
  if (!tags[0]) throw new ActionError(`Naukri doesn't know “${name}”. Try how Naukri spells it.`);
  return tags[0];
});

/** Sends the accepted changes to Naukri and answers the profile as it is afterwards. */
export const updateNaukriProfile = action(updateSchema, async (update, { toast }) => {
  await naukri((credentials, context) => naukriUpdateProfile(credentials, update, context));
  toast("Naukri profile updated.");
  return naukri(naukriEditableProfile);
});
