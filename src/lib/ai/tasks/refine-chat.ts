import { z } from "zod";

import { DocumentKind, Tone } from "@/generated/prisma/enums";
import { putBack, SIGN_OFF_UNIT, type Extracted, type Trimmed, type Unit, type UnitEdit } from "@/lib/application-data";
import { emailParts } from "@/lib/application-email";
import { isFrameUnit } from "@/lib/letter-frame";
import type { ProfileData } from "@/lib/profile";
import { TONES } from "@/lib/tones";
import { isCertificationUnit, isPublicationUnit } from "@/lib/unit-text";

import { documentLabels } from "@/lib/document-labels";

import { guardSources, unverifiedFacts } from "../fact-guard";

import { resumeUnits } from "./tailor-resume";
import {
  applicationFacts,
  candidateFacts,
  CREATIVITY,
  jobForPrompt,
  languageRule,
  NO_EM_DASHES,
  profileForPrompt,
  system,
  userPrompts,
  truthfulness,
  UNTRUSTED_POSTING,
  type Task,
} from "./prompt-parts";

export const REFINE_CHAT_VERSION = "refine-chat@13";

const answerSchema = z.object({
  reply: z.string(),
  edits: z.array(z.object({ document: z.enum(DocumentKind), unitId: z.string(), text: z.string() })),
  /** A different cover letter tone, only when asked for one. */
  tone: z.enum(Tone).nullable(),
  declined: z.boolean(),
  /** Left-out parts to put back on the resume, by their number in the list. */
  restore: z.array(z.number().int()).nullable().default(null),
  /** Profile entries not on the resume to add, as "project:<id>", "experience:<id>", "certification:<id>"… */
  add: z.array(z.string()).nullable().default(null),
  /** Resume units to leave out, by unitId. */
  remove: z.array(z.string()).nullable().default(null),
  /** A page count to fit, with the resume units to leave out for it, first to last. */
  fit: z.object({ pages: z.number().int(), cutInOrder: z.array(z.string()) }).nullable().default(null),
  /** How the resume looks, only what the request asks to change. */
  look: z
    .object({
      skills: z.array(z.object({ unitId: z.string(), show: z.boolean() })).nullable(),
      order: z.array(z.string()).nullable(),
      sidebar: z.boolean().nullable(),
      photo: z.boolean().nullable(),
      themeId: z.string().nullable(),
    })
    .nullable()
    .default(null),
});

const INSTRUCTIONS = `You help a candidate refine their tailored resume, cover letter and application email for one job, and answer as JSON.

- Change only what the request asks for. Each edit replaces one unit's whole text: give its document (RESUME, COVER_LETTER or EMAIL), its unitId and the new text. For a role or project, write bullets one per line without bullet characters.
- Never edit a certification (a unit whose unitId starts with "certification:") either: it's the candidate's own entry.
- Never edit a publication (a resume unit whose unitId starts with "publication:"): it's the candidate's citation, as they wrote it. If asked to, say they can edit it or leave it out themselves.
- The email goes out with the resume and cover letter attached. Its "to" unit is the recipient ("Name <address>"), "subject" its subject line and "body" the whole message, from the greeting to the sign-off and the candidate's name.
- tone: set it (WARM, DIRECT or FORMAL) only when the request asks for a different tone for the letter; otherwise null. When you change the tone, rewrite the letter's paragraphs to match. A different tone for the email is an edit to the email, not a new tone.
- Some parts of the resume may have been left out (to fit its page limit, or by the candidate). When the request asks for one back (e.g. "keep all the work experience"), list its number in restore. It goes back as it was, so in the same answer also edit it (by its unitId) to tailor it to this job like the rest of the resume. Otherwise restore is null.
- add: profile entries that aren't on the resume or the left-out list and the request asks to add, as "project:<id>", "experience:<id>", "education:<id>", "certification:<id>" or "publication:<id>" with the profile's id, or null. Each goes into its section with the profile's own text, so in the same answer also edit it (by that unitId) to tailor it to this job, except a certification or publication.
- remove: the unitIds of resume units the request asks to take off (a project, a certification, a publication, a role, languages…), or null. They're kept and can be put back. "Remove certifications" means every unit whose unitId starts with "certification:".
- fit: when the request asks the resume to fit a number of pages, set pages and cutInOrder: resume unitIds to leave out, first to last, following what the request says to cut (e.g. "by cutting projects" means only projects, the least relevant to this job first). The app measures the real PDF and leaves them out one at a time only until it fits, so list enough. You may also shorten units with edits. Otherwise null.
- To undo an earlier change ("undo that", "put it back how it was"): restore what it left out, remove what it put back, and edit units back to the text they had before (an earlier reply lists it after "Before this reply's edits"). Don't change anything else.
- look: only what the request asks about how the resume looks, else null (and null inside it for what doesn't change):
  - skills: show or hide the "Skills ·" line under a role or project (unitId starting "experience:" or "project:"). A unit with hideSkills true has it hidden now.
  - order: resume unitIds in the order they should read, e.g. a section's projects with the one to lead first. Only entries of the same section swap places.
  - sidebar: true for the theme's layout with its sidebar, false for a single column.
  - photo: true to show the profile photo, false to hide it.
  - themeId: one of the themes listed, to change fonts, colours and layout together.
- The headings, names, titles, dates and places of roles, projects and degrees come from the profile and can't change here: say the candidate can change them in their profile.
- Never say you changed something unless this answer's edits, restore, add, remove, fit or look does it.
- If the request needs facts the profile doesn't have (a skill, employer, number, credential…), don't make them up: set declined to true, make no edits, and say in reply what the candidate could add to their profile first.
- reply: one or two friendly sentences saying what you changed, or why you didn't.`;

export type ChatTurn = { role: "user" | "assistant"; text: string };

export type RefineInput = {
  request: string;
  /** Earlier messages, oldest first. */
  history: ChatTurn[];
  /** The unit the request is about, if the user picked one ("About: Summary"). */
  target: string | null;
  /** The document on screen, which a request without a target is most likely about. */
  viewing?: DocumentKind | null;
  resume: Unit[];
  letter: Unit[];
  /** The application's email, when it has one. */
  email?: Unit[];
  /** How the resume looks now, and the themes it can take. */
  look?: ResumeLook;
  /** What was left out of the resume (Document.trimmed), which restore can put back. */
  leftOut?: Trimmed;
  profile: ProfileData;
  extracted: Extracted;
  tone: Tone;
  /** What the candidate tells the AI for this application (APP-15). */
  facts: string[];
  /** The posting as pasted, for the fact guard. */
  posting: string;
};

export type ResumeLook = {
  themeId: string | null;
  themes: { id: string; name: string }[];
  /** The theme's layout, sidebar included; false is a single column. */
  followThemeLayout: boolean;
  /** null follows the profile's "Show on resumes". */
  showPhoto: boolean | null;
};

/** What to change about the resume's look; null where nothing changes. */
export type LookChange = {
  skills: { unitId: string; show: boolean }[];
  order: string[] | null;
  sidebar: boolean | null;
  photo: boolean | null;
  themeId: string | null;
};

export type Refinement = {
  reply: string;
  edits: UnitEdit[];
  tone: Tone | null;
  declined: boolean;
  /** Numbers in leftOut to put back, before the edits. */
  restore: number[];
  /** Units from the profile to add, before the edits. */
  add: string[];
  /** Resume unitIds to leave out, after the edits. */
  remove: string[];
  fit: { pages: number; cutInOrder: string[] } | null;
  look: LookChange | null;
  /** Whether the answer asked for any change, applied or not: one asked for that didn't apply mustn't read as done. */
  attempted: boolean;
};

/** The look change asked for, keeping only what's real and different; null when nothing changes. */
function lookChange(asked: z.infer<typeof answerSchema>["look"], units: Unit[], look: ResumeLook | undefined): LookChange | null {
  if (!asked) return null;
  const onResume = (id: string) => units.find((unit) => unit.id === id);
  const skills = (asked.skills ?? []).filter(({ unitId, show }) => {
    const unit = onResume(unitId);
    return unit && /^(experience|project):/.test(unitId) && show === (unit.hideSkills === true);
  });
  const order = [...new Set(asked.order ?? [])].filter((id) => onResume(id));
  const change: LookChange = {
    skills: [...new Map(skills.map((entry) => [entry.unitId, entry])).values()],
    order: order.length > 1 ? order : null,
    sidebar: look && asked.sidebar !== null && asked.sidebar !== look.followThemeLayout ? asked.sidebar : null,
    photo: look && asked.photo !== null && asked.photo !== look.showPhoto ? asked.photo : null,
    themeId: look && asked.themeId && asked.themeId !== look.themeId && look.themes.some((theme) => theme.id === asked.themeId) ? asked.themeId : null,
  };
  const changes = change.skills.length > 0 || change.order || change.sidebar !== null || change.photo !== null || change.themeId;
  return changes ? change : null;
}

/** Every unit the profile could put on a resume, in resume order, with the profile's own text. */
export function profileUnits(profile: ProfileData, language: string | null | undefined): Unit[] {
  return resumeUnits(profile, { summary: "", roles: [], projects: [], skills: [], education: [] }, documentLabels(language));
}

/**
 * Adds a profile entry to the resume in place, in its section: after the last
 * unit on the resume that comes before it. False when it's already there or
 * isn't a profile entry. The summary, skills and languages are always on.
 */
export function addProfileUnit(units: Unit[], all: Unit[], unitId: string): boolean {
  const at = all.findIndex((unit) => unit.id === unitId);
  if (at < 0 || !unitId.includes(":") || units.some((unit) => unit.id === unitId)) return false;
  const before = new Set(all.slice(0, at).map((unit) => unit.id));
  const after = units.findLastIndex((unit) => before.has(unit.id));
  units.splice(after + 1, 0, structuredClone(all[at]));
  return true;
}

/** How the request says which document is on screen. */
const LOOKING_AT: Record<DocumentKind, string> = {
  [DocumentKind.RESUME]: "the resume",
  [DocumentKind.COVER_LETTER]: "the cover letter",
  [DocumentKind.EMAIL]: "the email",
};

/** Only the last messages go along; older ones rarely matter and cost context. */
const HISTORY = 10;

/** APP-7, APP-9: a reply plus unit edits (with what they replace, for Undo), or a decline with guidance. */
export const refineChat: Task<RefineInput, Refinement> = async (provider, input, options) => {
  const { request, history, target, viewing, resume, letter, email = [], leftOut = [], look, profile, extracted, tone, facts, posting } = input;
  const looking = viewing ? LOOKING_AT[viewing] : null;
  const answer = await provider.complete({
    system: system(INSTRUCTIONS, `Current letter tone: ${TONES[tone].label}.`, truthfulness(options.strict), candidateFacts(profile, facts), CREATIVITY[options.creativity], languageRule(options.language), userPrompts(options, "global", "docs", viewing === DocumentKind.RESUME && "resume"), UNTRUSTED_POSTING, NO_EM_DASHES),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's profile:\n${profileForPrompt(profile)}`,
          `The job:\n${jobForPrompt(extracted, null)}`,
          `The resume's units:\n${JSON.stringify(resume, null, 2)}`,
          look &&
            `How the resume looks: theme ${look.themes.find((theme) => theme.id === look.themeId)?.name ?? "the base theme"}, ${look.followThemeLayout ? "the theme's layout with its sidebar" : "a single column"}, photo ${look.showPhoto === null ? "as the profile says" : look.showPhoto ? "shown" : "hidden"}.\nThemes (themeId: name): ${look.themes.map((theme) => `${theme.id}: ${theme.name}`).join("; ")}`,
          `The cover letter's units:\n${JSON.stringify(letter, null, 2)}`,
          leftOut.length > 0 &&
            `Left out of the resume, by number:\n${JSON.stringify(
              leftOut.map((item, number) =>
                item.kind === "unit" ? { number, unitId: item.unit.id, label: item.unit.label, text: item.unit.text } : { number, bulletsOf: item.label, lines: item.lines },
              ),
              null,
              2,
            )}`,
          email.length > 0 && `The email's units:\n${JSON.stringify(email, null, 2)}`,
          applicationFacts(facts),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      { role: "assistant", content: "Understood. What would you like to change?" },
      ...history.slice(-HISTORY).map((turn) => ({ role: turn.role, content: turn.text })),
      { role: "user", content: target ? `About ${target}: ${request}` : looking ? `(I'm looking at ${looking}.) ${request}` : request },
    ],
    schema: answerSchema,
    schemaName: "refinement",
    creativity: options.creativity,
    signal: options.signal,
  });

  const newTone = answer.tone && answer.tone !== tone ? answer.tone : null;
  // The email's recipient counts too: its greeting names them, from the posting or typed in by the user.
  const sources = options.strict ? guardSources(profile, extracted, [posting, emailParts(email).to].join("\n"), facts) : null;
  // Only numbers on the list, each once. Put back first, so the same answer can tailor what comes back.
  const restore = answer.declined ? [] : [...new Set(answer.restore ?? [])].filter((number) => number >= 0 && number < leftOut.length);
  const restored = structuredClone(resume);
  for (const number of restore) putBack(restored, leftOut[number]);
  const all = profileUnits(profile, options.language ?? extracted.language);
  const add = answer.declined ? [] : [...new Set(answer.add ?? [])].filter((unitId) => addProfileUnit(restored, all, unitId));
  const documents = { [DocumentKind.RESUME]: restored, [DocumentKind.COVER_LETTER]: letter, [DocumentKind.EMAIL]: email };
  // Only units that exist, each once; the text they replace is kept for Undo (APP-8).
  const edits = new Map<string, UnitEdit>();
  if (!answer.declined) {
    for (const edit of answer.edits) {
      const unit = documents[edit.document].find((entry) => entry.id === edit.unitId);
      const text = edit.text.trim();
      // A publication stays as the candidate wrote it (#218).
      if (unit && text && text !== unit.text && !isPublicationUnit(unit.id) && !isCertificationUnit(unit.id)) {
        // E6-6: in strict mode, note what the profile and posting don't back.
        const checked = edit.document === DocumentKind.EMAIL ? unit.id !== "to" : unit.id !== SIGN_OFF_UNIT && !isFrameUnit(unit.id);
        const unverified = sources && checked ? unverifiedFacts(text, sources) : [];
        edits.set(`${edit.document} ${unit.id}`, {
          document: edit.document,
          unitId: unit.id,
          text,
          previousText: unit.text,
          ...(unverified.length > 0 ? { unverified } : {}),
          ...(unit.unverified?.length ? { previousUnverified: unit.unverified } : {}),
        });
      }
    }
    // A new tone brings its own sign-off in English letters (APP-10).
    const signOff = letter.find((unit) => unit.id === SIGN_OFF_UNIT);
    const english = /^english$/i.test(options.language ?? extracted.language ?? "English");
    if (newTone && signOff && english) {
      edits.set(`${DocumentKind.COVER_LETTER} ${SIGN_OFF_UNIT}`, {
        document: DocumentKind.COVER_LETTER,
        unitId: SIGN_OFF_UNIT,
        text: TONES[newTone].signOff,
        previousText: signOff.text,
      });
    }
  }
  const onResume = (ids: string[] | null | undefined) => (answer.declined ? [] : [...new Set(ids ?? [])].filter((id) => restored.some((unit) => unit.id === id)));
  const cutInOrder = onResume(answer.fit?.cutInOrder);
  return {
    data: {
      reply: answer.reply.trim(),
      edits: [...edits.values()],
      tone: answer.declined ? null : newTone,
      declined: answer.declined,
      restore,
      add,
      look: answer.declined ? null : lookChange(answer.look, restored, look),
      attempted: !answer.declined && (answer.look !== null ? 1 : 0) + answer.edits.length + (answer.restore?.length ?? 0) + (answer.add?.length ?? 0) + (answer.remove?.length ?? 0) > 0,
      remove: onResume(answer.remove),
      fit: answer.fit && answer.fit.pages >= 1 && cutInOrder.length > 0 ? { pages: answer.fit.pages, cutInOrder } : null,
    },
    promptVersion: REFINE_CHAT_VERSION,
  };
};
