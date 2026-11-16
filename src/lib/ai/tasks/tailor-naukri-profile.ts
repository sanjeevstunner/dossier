import { z } from "zod";

import { DESIRED_ROLES_MAX, HEADLINE_MAX, KEY_SKILLS_MAX, SUMMARY_MAX, type NaukriEditable } from "@/lib/naukri-profile";
import type { ProfileData } from "@/lib/profile";

import { candidateFacts, CREATIVITY, NO_EM_DASHES, profileForPrompt, system, truthfulness, userPrompts, type Task } from "./prompt-parts";

export const TAILOR_NAUKRI_PROFILE_VERSION = "tailor-naukri-profile@1";

const answerSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  keySkills: z.array(z.string()),
  desiredRoles: z.array(z.string()),
  /** One short sentence per field on why it changed. */
  reasons: z.object({ headline: z.string(), summary: z.string(), keySkills: z.string(), desiredRoles: z.string() }),
});

export type NaukriProfileDraft = z.output<typeof answerSchema>;

const INSTRUCTIONS = `You tailor a candidate's Naukri.com profile so recruiters searching Naukri for one target role find and shortlist them, as JSON. Recruiters search by keywords, so the wording recruiters type for that role matters.

- headline: Naukri's "Resume headline", at most ${HEADLINE_MAX} characters. One line: who the candidate is for this role (title, years of experience if the profile shows them, and the strongest skills or domains for it), keyword-rich but readable.
- summary: Naukri's "Profile summary", at most ${SUMMARY_MAX} characters, in the first person, 2 short paragraphs: what the candidate does and has done that this role cares about, then what they bring and are looking for.
- keySkills: 12 to ${KEY_SKILLS_MAX} skills as recruiters search for them (e.g. "Node.js", "AWS Lambda", "System Design"), most important for the role first. Keep current Naukri key skills that still matter for the role, drop ones that don't, and add skills the profile shows that are missing. No duplicates, no commas inside a skill.
- desiredRoles: 1 to ${DESIRED_ROLES_MAX} job titles the candidate wants, as Naukri lists designations (common, standard titles such as "Full Stack Developer"), the target role first.
- reasons: for each field, one short sentence on what you changed and why. Say "No change needed" when you kept it.
- Keep what already works in the current Naukri profile; change what helps for this role.`;

/** Naukri's limits held, skills once each. */
export function cleanDraft(answer: NaukriProfileDraft): NaukriProfileDraft {
  const seen = new Set<string>();
  const keySkills = answer.keySkills
    .map((skill) => skill.replaceAll(",", " ").replace(/\s+/g, " ").trim().slice(0, 100))
    .filter((skill) => skill && !seen.has(skill.toLowerCase()) && seen.add(skill.toLowerCase()))
    .slice(0, KEY_SKILLS_MAX);
  const roles = [...new Set(answer.desiredRoles.map((role) => role.trim()).filter(Boolean))].slice(0, DESIRED_ROLES_MAX);
  return {
    headline: answer.headline.replaceAll("—", "-").trim().slice(0, HEADLINE_MAX),
    summary: answer.summary.replaceAll("—", "-").trim().slice(0, SUMMARY_MAX),
    keySkills,
    desiredRoles: roles,
    reasons: answer.reasons,
  };
}

export type TailorNaukriInput = { role: string; notes: string; current: NaukriEditable; profile: ProfileData };

/** Suggests a Naukri headline, summary, key skills and desired roles for one target role. */
export const tailorNaukriProfile: Task<TailorNaukriInput, NaukriProfileDraft> = async (provider, { role, notes, current, profile }, options) => {
  const naukriNow = {
    headline: current.headline,
    summary: current.summary,
    keySkills: current.keySkills,
    desiredRoles: current.desiredRoles.map((tag) => tag.name),
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
    effort: "low",
    signal: options.signal,
  });
  return { data: cleanDraft(answer), promptVersion: TAILOR_NAUKRI_PROFILE_VERSION };
};
