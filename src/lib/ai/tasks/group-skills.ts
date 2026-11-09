import { z } from "zod";

import { OTHER_SKILLS, sameName } from "@/lib/profile";

import { NO_EM_DASHES, system, type Task } from "./prompt-parts";

export const GROUP_SKILLS_VERSION = "group-skills@1";

const MAX_GROUPS = 8;
const MAX_NAME = 40;

const answerSchema = z.object({ groups: z.array(z.object({ name: z.string(), skills: z.array(z.string()) })) });

const INSTRUCTIONS = `You organise a candidate's skills into groups so a reader can find them quickly, as JSON.

- Make 3 to ${MAX_GROUPS} groups (fewer when there are few skills), each named in one to three words, e.g. "Languages", "Frontend", "Cloud & DevOps", "Data", "Design", "Tools", "Soft skills".
- Put every skill in exactly one group, copying its name exactly. Never add, rename or drop a skill.
- Put related skills together, most important first. Use "${OTHER_SKILLS}" only for what really fits nowhere.
- Write group names in the same language as the skills.`;

/** The groups as skill name to group name: only the profile's own skills, once each, with the ones left out under "Other". */
export function groupsFrom(names: string[], answer: z.infer<typeof answerSchema>): Map<string, string> {
  const result = new Map<string, string>();
  for (const group of answer.groups.slice(0, MAX_GROUPS)) {
    const label = group.name.replaceAll("—", "-").trim().slice(0, MAX_NAME) || OTHER_SKILLS;
    for (const skill of group.skills) {
      const name = names.find((candidate) => sameName(candidate, skill));
      if (name && !result.has(name)) result.set(name, label);
    }
  }
  for (const name of names) if (!result.has(name)) result.set(name, OTHER_SKILLS);
  return result;
}

/** Sorts skills into groups: skill name to group name. */
export const groupSkillsTask: Task<{ skills: string[] }, Map<string, string>> = async (provider, { skills }, { signal, language }) => {
  const answer = await provider.complete({
    system: system(INSTRUCTIONS, language ? `Write the group names in ${language}.` : null, NO_EM_DASHES),
    messages: [{ role: "user", content: `The skills:\n${JSON.stringify(skills)}` }],
    schema: answerSchema,
    schemaName: "skill_groups",
    creativity: "FAITHFUL",
    effort: "low",
    signal,
  });
  return { data: groupsFrom(skills, answer), promptVersion: GROUP_SKILLS_VERSION };
};
