import { z } from "zod";

import { unitsSchema, type Extracted, type Match, type Unit } from "@/lib/application-data";
import { publicationLabel } from "@/lib/citation";
import { documentLabels, ENGLISH_LABELS, languagesLine, type DocumentLabels } from "@/lib/document-labels";
import { certificationLine, resumeCertifications, resumePublications, sameName, skillsText, type ProfileData } from "@/lib/profile";

import { guardSources, guardUnits } from "../fact-guard";

import {
  applicationFacts,
  ownVersion,
  candidateFacts,
  CREATIVITY,
  jobForPrompt,
  languageRule,
  NO_EM_DASHES,
  profileForPrompt,
  system,
  hasUserPrompts,
  userPrompts,
  truthfulness,
  UNTRUSTED_POSTING,
  type Task,
} from "./prompt-parts";

export const TAILOR_RESUME_VERSION = "tailor-resume@13";

const answerSchema = z.object({
  summary: z.string(),
  roles: z.array(z.object({ id: z.string(), bullets: z.array(z.string()) })),
  projects: z.array(z.object({ id: z.string(), bullets: z.array(z.string()) })),
  /** Only asked for when the candidate's own prompt can change it: false hides the "Skills ·" line under each role or project. */
  showRoleSkills: z.boolean().optional(),
  showProjectSkills: z.boolean().optional(),
  /** The profile's skills, most relevant first; leave out ones that don't help. */
  skills: z.array(z.string()),
  education: z.array(z.object({ id: z.string(), notes: z.string() })),
});

const INSTRUCTIONS = (selective: boolean) => `You tailor a candidate's resume to one job, as JSON.

- summary: 2–3 sentences in the first person without "I" at the start of every sentence, about the candidate as this job would see them.
- roles: every role from the profile, by id, with 2–5 bullets each. Lead with what this job cares about, keep each bullet to one line, and start with a verb.
- projects: ${selective ? "only the projects the candidate's standing instructions and this job call for, by id (leave the others out)" : "every project from the profile, by id"}, with 1–3 bullets each, written like the roles' bullets: what was built and what it shows that this job cares about.
- The profile's bullets are source facts, not text to reuse. Never copy or lightly edit a bullet, and never paste a role or project description in as it is: write every bullet fresh as a concise, self-contained resume bullet (action verb, what was done, how, and the result or scale where the profile gives one). Merge, split or reorder facts as needed, and drop what doesn't help. Rewriting must keep every fact, tool, number and outcome that matters: change the wording, never the substance or the level of detail.
- skills: the candidate's own skills, most relevant to this job first. Copy their names exactly; you may leave out ones that don't help.
- education: every entry by id, with its notes shortened or left empty.
- The profile's publications and certifications go on the resume as they are, so don't answer with them; the summary may mention them.`;

/**
 * Added when the candidate wrote their own prompt for this resume: what they
 * ask for in what to include, how much to say and what to show wins over the
 * defaults above, while the facts stay as they are.
 */
const SELECTIVE = `The candidate's standing instructions (below) decide what the resume emphasises, so where they conflict with the defaults above about which projects to include, how many bullets an entry gets (up to 6 for a role, 4 for a project) or what to show, follow the instructions:
- Every role stays in the answer, by id, however much emphasis it gets: never leave a role out.
- Leave a project out of "projects" when the instructions say to include only some, or the job doesn't call for it.
- showRoleSkills and showProjectSkills: false when the instructions say not to list skills under roles or projects, else true.`;

/** SET-9: asked for when "Resume length" has a limit; anything still over is trimmed afterwards (E10-10). */
function pageFit(maxPages: number | null | undefined): string | null {
  if (maxPages === 1) {
    return "The resume has to fit on one page: keep the summary to two sentences, give the most relevant roles 3–4 bullets and older roles 2, and keep education and project notes to a few words.";
  }
  if (maxPages === 2) {
    return "The resume has to fit on two pages: keep the summary to three sentences, give the most relevant roles 4–5 bullets and older roles 2–3, and keep education and project notes short.";
  }
  return null;
}

export type TailorInput = {
  profile: ProfileData;
  extracted: Extracted;
  match: Match | null;
  /** What the candidate tells the AI for this application (APP-15). */
  facts: string[];
  /** The posting as pasted, for the fact guard. */
  posting: string;
  /** The candidate's own resume, as they sent it, to tailor rather than start from the profile alone. */
  source?: string;
};

/** APP-4: the tailored resume as units (summary, each role, each project, skills, each degree, each publication, languages). */
export const tailorResume: Task<TailorInput, Unit[]> = async (provider, { profile, extracted, match, facts, posting, source }, options) => {
  const selective = hasUserPrompts(options, "global", "docs", "resume");
  const answer = await provider.complete({
    system: system(
      INSTRUCTIONS(selective),
      selective && SELECTIVE,
      pageFit(options.maxPages),
      truthfulness(options.strict),
      candidateFacts(profile, facts),
      CREATIVITY[options.creativity],
      languageRule(options.language),
      userPrompts(options, "global", "docs", "resume"),
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's profile:\n${profileForPrompt(profile)}`,
          `The job:\n${jobForPrompt(extracted, match)}`,
          applicationFacts(facts),
          ownVersion(source),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "tailored_resume",
    creativity: options.creativity,
    signal: options.signal,
  });
  // The languages line in the resume's language: the chosen one, or the posting's.
  // A custom prompt may drop projects (selective); without one, every project stays.
  const units = resumeUnits(profile, answer, documentLabels(options.language ?? extracted.language), { selective });
  // E6-6: in strict mode, note what the profile and posting don't back.
  return {
    data: options.strict ? guardUnits(units, guardSources(profile, extracted, posting, source ? [...facts, source] : facts)) : units,
    promptVersion: TAILOR_RESUME_VERSION,
  };
};

/**
 * Turns the answer into units, trusting nothing: unknown roles, projects and
 * degrees are dropped, skills must be the profile's own, and a role or
 * project the model skipped keeps its bullets from the profile. The publications and languages
 * come from the profile, publications word for word (#218), and languages with their levels in
 * the words of `labels`.
 */
export function resumeUnits(profile: ProfileData, answer: z.infer<typeof answerSchema>, labels: DocumentLabels = ENGLISH_LABELS, { selective = false }: { selective?: boolean } = {}): Unit[] {
  // A custom prompt may leave projects out; an answer with no roles and no projects is a failure, not a choice.
  const dropProjects = selective && (answer.roles.length > 0 || answer.projects.length > 0);
  // Only a custom prompt can hide the skills under an entry.
  const hide = (show: boolean | undefined) => selective && show === false;
  const roles = new Map(answer.roles.map((role) => [role.id, role.bullets]));
  const projects = new Map(answer.projects.map((project) => [project.id, project.bullets]));
  const notes = new Map(answer.education.map((entry) => [entry.id, entry.notes]));
  // The profile's own skills in the answer's order; skillsText puts them in the profile's groups.
  const skills = [...new Set(answer.skills.flatMap((name) => profile.skills.find((skill) => sameName(skill.name, name)) ?? []))];
  const units: Unit[] = [
    { id: "summary", label: "Summary", text: answer.summary.trim() },
    ...profile.experience.map((entry) => {
      const bullets = (roles.get(entry.id) ?? entry.bullets.split("\n")).map((line) => line.trim()).filter(Boolean);
      return { id: `experience:${entry.id}`, label: `${entry.company || entry.role} role`, text: bullets.join("\n"), ...(hide(answer.showRoleSkills) && { hideSkills: true as const }) };
    }),
    ...profile.projects.filter((entry) => !dropProjects || projects.has(entry.id)).map((entry) => {
      const bullets = (projects.get(entry.id) ?? entry.bullets.split("\n")).map((line) => line.trim()).filter(Boolean);
      return { id: `project:${entry.id}`, label: `${entry.name || "Untitled"} project`, text: bullets.join("\n"), ...(hide(answer.showProjectSkills) && { hideSkills: true as const }) };
    }),
    { id: "skills", label: "Skills", text: skillsText(skills, profile.groupSkills !== false) },
    ...profile.education.map((entry) => ({
      id: `education:${entry.id}`,
      label: entry.degree || entry.school,
      text: (notes.get(entry.id) ?? entry.notes).trim(),
    })),
    ...resumeCertifications(profile.certifications).map((entry) => ({
      id: `certification:${entry.id}`,
      label: entry.name.trim(),
      text: certificationLine(entry, { locale: labels.locale, present: labels.present }),
    })),
    ...resumePublications(profile.publications).map((entry) => ({
      id: `publication:${entry.id}`,
      label: publicationLabel(entry.citation),
      text: entry.citation.trim(),
    })),
    {
      id: "languages",
      label: "Languages",
      text: languagesLine(profile.languages, labels),
    },
  ];
  return unitsSchema.parse(units);
}
