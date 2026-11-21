"use server";

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { getAiProvider } from "@/lib/ai";
import { isAiConfigured } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { tailorNaukriProfile } from "@/lib/ai/tasks";
import { mergeDraft } from "@/lib/ai/tasks/tailor-naukri-profile";
import { credentialsFor, loadJobSearchConfig, requestContext } from "@/lib/job-search/config";
import { JobSearchError } from "@/lib/job-search/errors";
import { naukriEditableProfile, naukriLookup, naukriOptions, naukriUpdateProfile } from "@/lib/job-search/naukri";
import {
  AI_KEYS,
  BASICS_FIELDS,
  courseList,
  isNew,
  itemProblem,
  PERSONAL_FIELDS,
  SECTIONS,
  specList,
  updateSchema,
  type LookupType,
  type NaukriEditable,
  type NaukriOption,
  type NaukriRef,
  type NaukriTag,
  type OptionList,
  type SectionItem,
  type SectionName,
  type Suggestion,
} from "@/lib/naukri-profile";
import { withProfileFacts } from "@/lib/naukri-profile-facts";
import { loadProfile } from "@/lib/profile-data";

type Credentials = ReturnType<typeof credentialsFor<"NAUKRI">>;

/** Runs `work` with NopeRi's Naukri credentials; a missing setup or sign-in becomes an ActionError in words. */
async function naukri<T>(work: (credentials: Credentials, context: ReturnType<typeof requestContext>) => Promise<T>): Promise<T> {
  try {
    return await work(credentialsFor(await loadJobSearchConfig(), "NAUKRI"), requestContext("NAUKRI"));
  } catch (error) {
    if (error instanceof JobSearchError) throw new ActionError(error.message);
    throw error;
  }
}

/** Naukri's best match for a name: the exact one (any case) when there is one, else its first guess; null when it knows nothing like it. */
function bestMatch<T extends { name: string }>(options: T[], name: string): T | null {
  const wanted = name.trim().toLowerCase();
  return options.find((option) => option.name.toLowerCase() === wanted) ?? options[0] ?? null;
}

/** Looks names up once each, for a whole suggestion. */
function lookups(credentials: Credentials, context: ReturnType<typeof requestContext>) {
  const seen = new Map<string, Promise<NaukriTag | null>>();
  const lists = new Map<OptionList, Promise<NaukriOption[]>>();
  const tag = (type: LookupType, name: string) => {
    const key = `${type}:${name.trim().toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, name.trim().length < 2 ? Promise.resolve(null) : naukriLookup(credentials, type, name, context).then((found) => bestMatch(found, name)));
    return seen.get(key)!;
  };
  const ref = async (type: LookupType, value: NaukriRef): Promise<NaukriRef> => {
    if (value.id || !value.name.trim()) return value;
    const found = await tag(type, value.name);
    return found ? { id: String(found.id), name: found.name } : value;
  };
  const options = (list: OptionList) => {
    if (!lists.has(list)) lists.set(list, naukriOptions(credentials, list, context));
    return lists.get(list)!;
  };
  return { tag, ref, options };
}

/**
 * Naukri's ids for what the suggestion only names: roles, companies, skills,
 * institutes and certificates of new items, and a new degree's course and
 * specialisation. A name Naukri doesn't know stays free text, except a
 * degree's course, which Naukri needs: that item is left out.
 */
async function resolveIds(values: NaukriEditable, find: ReturnType<typeof lookups>, unresolved: string[]): Promise<NaukriEditable> {
  /** The items, with `fix` applied to the new ones; a fix answering null leaves that item out. */
  const newOnes = async <T extends { id?: string }>(items: T[], fix: (item: T) => Promise<T | null>): Promise<T[]> =>
    (await Promise.all(items.map((item) => (isNew(item) ? fix(item) : item)))).filter((item): item is Awaited<T> => item !== null);

  const [employments, itSkills, educations, certifications] = await Promise.all([
    newOnes(values.employments, async (item) => ({ ...item, designation: await find.ref("designation", item.designation), company: await find.ref("company", item.company) })),
    newOnes(values.itSkills, async (item) => ({ ...item, skill: await find.ref("skill", item.skill) })),
    newOnes(values.educations, async (item) => {
      const [courses, specs] = await Promise.all([find.options(courseList(item.level)), find.options(specList(item.level))]);
      const course = bestMatch(courses.filter((option) => option.name.toLowerCase().includes(item.course.name.toLowerCase().split(/[ /]/)[0] ?? "")), item.course.name);
      if (!course) {
        unresolved.push(item.course.name);
        return null;
      }
      const specialisation = bestMatch(specs.filter((option) => option.parentId === course.id && option.name.toLowerCase().includes(item.specialisation.name.toLowerCase().slice(0, 8))), item.specialisation.name)
        ?? specs.find((option) => option.parentId === course.id);
      if (!specialisation) {
        unresolved.push(`${item.course.name} ${item.specialisation.name}`);
        return null;
      }
      return { ...item, course: { id: course.id, name: course.name }, specialisation: { id: specialisation.id, name: specialisation.name }, institute: await find.ref("institute", item.institute) };
    }),
    newOnes(values.certifications, async (item) => ({ ...item, name: await find.ref("certification", item.name) })),
  ]);
  return { ...values, employments, itSkills, educations, certifications };
}

const target = z.object({
  role: z.string().trim().min(2, "Name the role you're after.").max(150),
  notes: z.string().trim().max(2000),
  /** One section's parts; the whole profile when not given. An empty list asks only for the profile's facts. */
  only: z.array(z.enum(AI_KEYS)).max(AI_KEYS.length).optional(),
  instruction: z.string().trim().max(500).optional(),
});

/**
 * Suggests the Naukri profile, or one section of it, for a target role: the
 * AI writes the words and adds what the Dossier profile has that Naukri
 * lacks; the Dossier profile gives the facts (experience, personal details,
 * links, languages). The screen takes only the asked section from the answer.
 */
export const suggestNaukriProfile = action(target, async ({ role, notes, only, instruction }): Promise<Suggestion> => {
  const ai = only === undefined || only.length > 0;
  if (ai && !(await isAiConfigured())) throw new ActionError("Choose an AI provider in Settings → AI provider first.");
  const [current, profile] = await Promise.all([naukri(naukriEditableProfile), loadProfile()]);
  const data = ai ? (await tailorNaukriProfile(await getAiProvider(), { role, notes, current, profile, only, instruction }, await loadTaskOptions())).data : { reasons: {} };
  const facts = withProfileFacts(mergeDraft(current, data), profile, new Date());

  return naukri(async (credentials, context) => {
    const find = lookups(credentials, context);
    const unresolved: string[] = [];
    const roles = (await Promise.all((data.desiredRoles ?? []).map(async (name) => (await find.tag("designation", name)) ?? (unresolved.push(name), null)))).filter((tag) => tag !== null);
    const city = facts.city ? await find.tag("location", facts.city) : null;
    const values = await resolveIds(facts.values, find, unresolved);
    return {
      ...values,
      desiredRoles: roles.length ? [...new Map(roles.map((tag) => [tag.id, tag])).values()] : current.desiredRoles,
      basics: { ...values.basics, city: city ?? values.basics.city },
      reasons: data.reasons,
      unresolved,
    };
  });
});

const lookupTypes = z.enum(["location", "designation", "company", "institute", "skill", "certification"]);

/** Naukri's tag for a name typed on the screen: its best match, or null when Naukri knows nothing like it. */
export const lookUpNaukriTag = action(z.object({ type: lookupTypes, name: z.string().trim().min(2).max(200) }), async ({ type, name }) =>
  naukri(async (credentials, context) => bestMatch(await naukriLookup(credentials, type, name, context), name)),
);

/** One of Naukri's dropdowns (courses, specialisations, grading, marital status). */
export const naukriDropdown = action(
  z.object({ list: z.enum(["UGCOURSE", "PGCOURSE", "PPGCOURSE", "UGSPEC", "PGSPEC", "PPGSPEC", "GRADING_SYSTEM"]) }),
  async ({ list }) => naukri((credentials, context) => naukriOptions(credentials, list, context)),
);

/** Sends the accepted changes to Naukri and answers the profile as it is afterwards. */
export const updateNaukriProfile = action(updateSchema, async (update, { toast }) => {
  const problems = [
    ...Object.entries(update.sections ?? {}).flatMap(([name, items]) =>
      (items as SectionItem[]).flatMap((item) => {
        const problem = itemProblem(SECTIONS[name as SectionName].fields, item as Record<string, unknown>);
        return problem ? [`${SECTIONS[name as SectionName].label}: ${problem}`] : [];
      }),
    ),
    update.basics && itemProblem(BASICS_FIELDS.filter((field) => field.key in update.basics!), update.basics),
    update.personal && itemProblem(PERSONAL_FIELDS.filter((field) => field.key in update.personal!), update.personal),
  ].filter(Boolean);
  if (problems.length) throw new ActionError(problems.join(" "));
  try {
    await naukri((credentials, context) => naukriUpdateProfile(credentials, update, context));
  } catch (error) {
    // Saves run one after another: some may have gone through, so show what Naukri has now.
    const now = await naukri(naukriEditableProfile).catch(() => null);
    if (error instanceof ActionError && now) throw new ActionError(`${error.message} Some changes may have been saved: reload to see your Naukri profile as it is now.`);
    throw error;
  }
  toast("Naukri profile updated.");
  return naukri(naukriEditableProfile);
});
