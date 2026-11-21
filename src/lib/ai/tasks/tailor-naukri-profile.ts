import { z } from "zod";

import { DESIRED_ROLES_MAX, fitKeySkills, HEADLINE_MAX, KEY_SKILLS_CHARS, KEY_SKILLS_MAX, SUMMARY_MAX, type NaukriEditable, type SectionItem } from "@/lib/naukri-profile";
import type { ProfileData } from "@/lib/profile";

import { candidateFacts, CREATIVITY, NO_EM_DASHES, profileForPrompt, system, truthfulness, userPrompts, type Task } from "./prompt-parts";

export const TAILOR_NAUKRI_PROFILE_VERSION = "tailor-naukri-profile@2";

// Every field is required and empty values are "" or 0: OpenAI's structured outputs reject optional ones.
const answerSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  keySkills: z.array(z.string()),
  desiredRoles: z.array(z.string()),
  employments: z.array(
    z.object({ id: z.string(), designation: z.string(), company: z.string(), current: z.boolean(), start: z.string(), end: z.string(), description: z.string(), skills: z.array(z.string()) }),
  ),
  itSkills: z.array(z.object({ id: z.string(), skill: z.string(), version: z.string(), lastUsed: z.number(), years: z.number(), months: z.number() })),
  projects: z.array(
    z.object({ id: z.string(), title: z.string(), client: z.string(), role: z.string(), start: z.string(), end: z.string(), skills: z.string(), details: z.string() }),
  ),
  educations: z.array(
    z.object({ id: z.string(), level: z.number(), course: z.string(), specialisation: z.string(), institute: z.string(), courseType: z.string(), startYear: z.number(), endYear: z.number() }),
  ),
  certifications: z.array(z.object({ id: z.string(), name: z.string(), url: z.string(), issued: z.string(), expires: z.string() })),
  publications: z.array(z.object({ id: z.string(), title: z.string(), url: z.string(), description: z.string(), published: z.string() })),
  workSamples: z.array(z.object({ id: z.string(), title: z.string(), url: z.string(), description: z.string(), start: z.string(), end: z.string() })),
  /** One short sentence per field or section on what changed and why. */
  reasons: z.object({
    headline: z.string(),
    summary: z.string(),
    keySkills: z.string(),
    desiredRoles: z.string(),
    employments: z.string(),
    itSkills: z.string(),
    projects: z.string(),
    educations: z.string(),
    certifications: z.string(),
    publications: z.string(),
    workSamples: z.string(),
  }),
});

export type NaukriProfileDraft = z.output<typeof answerSchema>;

const INSTRUCTIONS = `You tailor a candidate's whole Naukri.com profile so recruiters searching Naukri for one target role find and shortlist them, as JSON. Recruiters search by keywords, so the wording recruiters type for that role matters.

- headline: Naukri's "Resume headline", at most ${HEADLINE_MAX} characters. One line: who the candidate is for this role (title, years of experience if the profile shows them, the strongest skills or domains for it), keyword-rich but readable.
- summary: Naukri's "Profile summary", at most ${SUMMARY_MAX} characters, in the first person, 2 short paragraphs: what the candidate does and has done that this role cares about, then what they bring and are looking for.
- keySkills: 12 to ${KEY_SKILLS_MAX} skills as recruiters search for them, most important for the role first, at most ${KEY_SKILLS_CHARS} characters in all once comma-joined (Naukri rejects more). Keep current Naukri key skills that still matter, drop ones that don't, add ones the profile shows. No duplicates, no commas inside a skill.
- desiredRoles: 1 to ${DESIRED_ROLES_MAX} job titles as Naukri lists designations (common, standard titles), the target role first.

The list sections (employments, itSkills, projects, educations, certifications, publications, workSamples):
- Return every item Naukri has now, by its id, then any new ones with id "". Never leave an item out: removing is the candidate's decision.
- Items already on Naukri: keep their facts (designation, company, dates, course, institute, years, skill name) exactly as they are. Rewrite only the words: an employment's description (Naukri's "Job profile", 3–6 lines on what was done and the results, for this role) and its skills; a project's details, role and skills.
- Add an item only for something the candidate's profile has and Naukri doesn't: a role, a project, a degree, a certification, a publication, or a project with a public link as a work sample. Copy its facts from the profile.
- itSkills: the technical skills and tools behind this role, each once, with its version if known, the year last used and the experience in years and months from the roles that used it. Add the profile's ones that matter for this role; keep the others.
- Dates are "YYYY-MM"; an unknown or ongoing end is "". Years are numbers, 0 when unknown. educations.level is 1 (graduation/diploma), 2 (masters) or 3 (doctorate); courseType is "F" (full time), "P" (part time) or "C" (distance).
- reasons: for each field and section, one short sentence on what you changed and why, or "No change needed".`;

/** Naukri's limits held, skills and roles once each. */
export function cleanDraft(answer: NaukriProfileDraft): NaukriProfileDraft {
  const seen = new Set<string>();
  const keySkills = fitKeySkills(answer.keySkills
    .map((skill) => skill.replaceAll(",", " ").replace(/\s+/g, " ").trim().slice(0, 100))
    .filter((skill) => skill && !seen.has(skill.toLowerCase()) && seen.add(skill.toLowerCase()))
    .slice(0, KEY_SKILLS_MAX));
  const roles = [...new Set(answer.desiredRoles.map((role) => role.trim()).filter(Boolean))].slice(0, DESIRED_ROLES_MAX);
  const dashes = (text: string) => text.replaceAll("—", "-").trim();
  return {
    ...answer,
    headline: dashes(answer.headline).slice(0, HEADLINE_MAX),
    summary: dashes(answer.summary).slice(0, SUMMARY_MAX),
    keySkills,
    desiredRoles: roles,
    employments: answer.employments.map((item) => ({ ...item, description: dashes(item.description).slice(0, 4000) })),
    projects: answer.projects.map((item) => ({ ...item, details: dashes(item.details).slice(0, 4000) })),
  };
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const month = (value: string) => (MONTH.test(value.trim()) ? value.trim() : null);
const yearOf = (value: number) => (value >= 1950 && value <= 2100 ? Math.round(value) : null);
const named = (name: string) => ({ id: null, name: name.trim() });

/**
 * The AI's answer laid over the current profile, section by section: items
 * on Naukri keep their facts and take only the rewritten words; new items
 * come in with names for their ids (looked up after), under temporary ids.
 * Items the answer leaves out stay as they are; nothing is removed.
 */
export function mergeDraft(current: NaukriEditable, draft: NaukriProfileDraft): NaukriEditable {
  let next = 0;
  const fresh = () => `new-${++next}`;
  const byId = <T extends { id?: string }>(items: T[]) => new Map(items.map((item) => [item.id, item]));
  /** Each current item, changed by `edit` when the answer has it, then the answer's new ones made by `add`. */
  const merge = <T extends { id?: string }, D extends { id: string }>(items: T[], answered: D[], edit: (item: T, draft: D) => T, add: (draft: D) => T | null): T[] => {
    const drafts = byId(answered.filter((item) => item.id));
    return [
      ...items.map((item) => (drafts.has(item.id!) ? edit(item, drafts.get(item.id!)!) : item)),
      ...answered.filter((item) => !item.id || !items.some((kept) => kept.id === item.id)).flatMap((item) => {
        const added = add(item);
        return added ? [{ ...added, id: fresh() }] : [];
      }),
    ];
  };

  return {
    ...current,
    headline: draft.headline || current.headline,
    summary: draft.summary || current.summary,
    keySkills: draft.keySkills.length ? draft.keySkills : current.keySkills,
    employments: merge<SectionItem<"employments">, NaukriProfileDraft["employments"][number]>(
      current.employments,
      draft.employments,
      (item, d) => ({ ...item, description: d.description.trim() || item.description, skills: d.skills.length ? d.skills.map((skill) => skill.trim()).filter(Boolean) : item.skills }),
      (d) =>
        d.designation.trim() && d.company.trim() && month(d.start)
          ? { current: d.current, designation: named(d.designation), company: named(d.company), start: month(d.start)!, end: d.current ? null : month(d.end), description: d.description.trim(), skills: d.skills, experienceType: "F" }
          : null,
    ),
    itSkills: merge<SectionItem<"itSkills">, NaukriProfileDraft["itSkills"][number]>(
      current.itSkills,
      draft.itSkills,
      (item) => item,
      (d) =>
        d.skill.trim()
          ? { skill: named(d.skill), version: d.version.trim().slice(0, 20), lastUsed: yearOf(d.lastUsed), experience: { years: Math.max(0, Math.min(50, Math.round(d.years))), months: Math.max(0, Math.min(11, Math.round(d.months))) } }
          : null,
    ),
    projects: merge<SectionItem<"projects">, NaukriProfileDraft["projects"][number]>(
      current.projects,
      draft.projects,
      (item, d) => ({ ...item, details: d.details.trim() || item.details, role: d.role.trim() || item.role, skills: d.skills.trim() || item.skills }),
      (d) => (d.title.trim() && month(d.start) ? { title: d.title.trim(), client: d.client.trim() || "Self", role: d.role.trim(), start: month(d.start)!, end: month(d.end), skills: d.skills.trim(), details: d.details.trim() } : null),
    ),
    educations: merge<SectionItem<"educations">, NaukriProfileDraft["educations"][number]>(
      current.educations,
      draft.educations,
      (item) => item,
      // The course and specialisation ids are found from these names after.
      (d) =>
        d.course.trim() && d.institute.trim()
          ? {
              level: ([1, 2, 3].includes(d.level) ? d.level : 1) as 1 | 2 | 3,
              course: { id: 1, name: d.course.trim() },
              specialisation: { id: 1, name: d.specialisation.trim() },
              institute: named(d.institute),
              courseType: (["F", "P", "C"].includes(d.courseType) ? d.courseType : "F") as "F" | "P" | "C",
              startYear: yearOf(d.startYear),
              endYear: yearOf(d.endYear),
              grade: null,
              marks: "",
              primary: false,
            }
          : null,
    ),
    certifications: merge<SectionItem<"certifications">, NaukriProfileDraft["certifications"][number]>(
      current.certifications,
      draft.certifications,
      (item) => item,
      (d) => (d.name.trim() ? { name: named(d.name), url: /^https?:\/\//.test(d.url) ? d.url.trim() : "", issued: month(d.issued), expires: month(d.expires) } : null),
    ),
    publications: merge<SectionItem<"publications">, NaukriProfileDraft["publications"][number]>(
      current.publications,
      draft.publications,
      (item) => item,
      (d) => (d.title.trim() ? { title: d.title.trim().slice(0, 250), url: /^https?:\/\//.test(d.url) ? d.url.trim() : "", description: d.description.trim(), published: month(d.published) } : null),
    ),
    workSamples: merge<SectionItem<"workSamples">, NaukriProfileDraft["workSamples"][number]>(
      current.workSamples,
      draft.workSamples,
      (item) => item,
      (d) => (d.title.trim() && /^https?:\/\//.test(d.url) ? { title: d.title.trim(), url: d.url.trim(), description: d.description.trim(), start: month(d.start), end: month(d.end) } : null),
    ),
  };
}

export type TailorNaukriInput = { role: string; notes: string; current: NaukriEditable; profile: ProfileData };

/** Suggests the whole Naukri profile for one target role (the answer as the AI gave it; mergeDraft lays it over the profile). */
export const tailorNaukriProfile: Task<TailorNaukriInput, NaukriProfileDraft> = async (provider, { role, notes, current, profile }, options) => {
  // Personal details stay out of the prompt, as everywhere (PRD §7).
  const { headline, summary, keySkills, employments, itSkills, educations, projects, onlineProfiles, workSamples, publications, presentations, patents, certifications, languages } = current;
  const naukriNow = {
    ...{ headline, summary, keySkills, employments, itSkills, educations, projects, onlineProfiles, workSamples, publications, presentations, patents, certifications, languages },
    desiredRoles: current.desiredRoles.map((tag) => tag.name),
    experience: current.basics.experience,
  };
  const answer = await provider.complete({
    system: system(
      INSTRUCTIONS,
      truthfulness(options.strict),
      candidateFacts(profile, notes ? [notes] : []),
      CREATIVITY[options.creativity],
      options.language ? `Write in ${options.language}.` : "Write in English.",
      NO_EM_DASHES,
      userPrompts(options, "global"),
    ),
    messages: [
      {
        role: "user",
        content: [
          `Target role: ${role}`,
          notes && `What the candidate tells you for this:\n${notes}`,
          `Their Naukri profile now:\n${JSON.stringify(naukriNow)}`,
          `Their profile:\n${profileForPrompt(profile)}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "naukri_profile",
    creativity: options.creativity,
    effort: "medium",
    signal: options.signal,
  });
  return { data: cleanDraft(answer), promptVersion: TAILOR_NAUKRI_PROFILE_VERSION };
};
