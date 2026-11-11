import { LanguageLevel } from "@/generated/prisma/enums";
import type { ProfilePhoto } from "@/lib/photo";

/** Proficiency levels in the order the language select lists them (PRD PRO-4). */
export const LANGUAGE_LEVELS: readonly { value: LanguageLevel; label: string }[] = [
  { value: LanguageLevel.NATIVE, label: "Native" },
  { value: LanguageLevel.C2, label: "Fluent (C2)" },
  { value: LanguageLevel.C1, label: "Advanced (C1)" },
  { value: LanguageLevel.B2, label: "Upper intermediate (B2)" },
  { value: LanguageLevel.B1, label: "Intermediate (B1)" },
  { value: LanguageLevel.A2, label: "Elementary (A2)" },
  { value: LanguageLevel.A1, label: "Beginner (A1)" },
];

export function languageLevelLabel(level: LanguageLevel): string {
  return LANGUAGE_LEVELS.find((option) => option.value === level)?.label ?? level;
}

/** The dates of an experience, project or education entry. Months are 1–12. */
export type DateSpan = {
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
  /** Still ongoing ("Present"); the end date is ignored. */
  current: boolean;
};

type DateFormatOptions = {
  /** Locale for month names, e.g. the document's language. */
  locale?: string;
  /** Word for an ongoing entry. */
  present?: string;
};

/**
 * "Mar 2021", or "2013" without a month, or "" without a year, in the
 * locale's own order and digits ("2021年3月", "سپتامبر ۲۰۲۱").
 */
export function formatMonthYear(
  year: number | null,
  month: number | null,
  { locale = "en-US" }: DateFormatOptions = {},
): string {
  if (year === null) return "";
  // The profile's dates are Gregorian, even where the locale's calendar isn't (Persian).
  return new Intl.DateTimeFormat(`${locale}-u-ca-gregory`, {
    year: "numeric",
    month: month === null ? undefined : "short",
    timeZone: "UTC",
  }).format(Date.UTC(year, (month ?? 1) - 1, 1));
}

/** "Mar 2021 – Present", "2013 – 2015", "Sep 2015 – May 2018", or a single date. */
export function formatDateRange(span: DateSpan, options: DateFormatOptions = {}): string {
  const start = formatMonthYear(span.startYear, span.startMonth, options);
  const end = span.current
    ? (options.present ?? "Present")
    : formatMonthYear(span.endYear, span.endMonth, options);
  return [start, end].filter(Boolean).join(" – ");
}

/** The Basics fields in the form's order (PRO-1). */
export const BASICS_FIELDS = [
  "name",
  "headline",
  "email",
  "phone",
  "dob",
  "website",
  "address",
  "city",
  "country",
  "linkedin",
  "summary",
] as const;
export type BasicsField = (typeof BASICS_FIELDS)[number];

/** The Basics fields a profile needs (#216); the rest are optional, and the section count is "filled/6". */
export const REQUIRED_BASICS = ["name", "headline", "email", "city", "country", "summary"] as const satisfies readonly BasicsField[];

/** Whether a Basics field is optional: phone, date of birth, address, website and LinkedIn. */
export const isOptionalBasic = (field: BasicsField) => !(REQUIRED_BASICS as readonly BasicsField[]).includes(field);

// The profile as the editor works with it: plain values (dates of birth as
// "YYYY-MM-DD"), loaded by loadProfile() in src/lib/profile-data.ts.

export type Basics = Record<BasicsField, string> & { showAge: boolean };

// The basics are stored in the ProfileField table, one text row per filled-in
// field: text as typed, the date of birth as "YYYY-MM-DD", showAge as "true".

/** The keys in the ProfileField table. */
export const PROFILE_KEYS = [...BASICS_FIELDS, "showAge"] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

/** The basics from ProfileField rows; a missing key is empty, and keys it doesn't know are ignored. */
export function basicsFromFields(rows: readonly { key: string; value: string }[]): Basics {
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const basics = Object.fromEntries(BASICS_FIELDS.map((field) => [field, values.get(field) ?? ""]));
  return { ...(basics as Record<BasicsField, string>), showAge: values.get("showAge") === "true" };
}

/** The value to store for each key, or null for an empty one, whose row is removed. */
export function fieldsFromBasics(basics: Basics): Record<ProfileKey, string | null> {
  const fields = Object.fromEntries(BASICS_FIELDS.map((field) => [field, basics[field] || null]));
  return { ...(fields as Record<BasicsField, string | null>), showAge: basics.showAge ? "true" : null };
}

export type SkillItem = { id: string; name: string; /** The AI's group for it; empty or missing when not grouped. */ group?: string };

export const OTHER_SKILLS = "Other";
export type SkillGroup<T extends { group?: string } = SkillItem> = { name: string; skills: T[] };

/** The skills in their groups (the group of the first skill first, "Other" last), or null when none is grouped. */
export function groupSkills<T extends { group?: string }>(skills: readonly T[]): SkillGroup<T>[] | null {
  if (!skills.some((skill) => skill.group)) return null;
  const groups = new Map<string, T[]>();
  for (const skill of skills) groups.set(skill.group || OTHER_SKILLS, [...(groups.get(skill.group || OTHER_SKILLS) ?? []), skill]);
  const other = groups.get(OTHER_SKILLS);
  groups.delete(OTHER_SKILLS);
  return [...groups, ...(other ? [[OTHER_SKILLS, other] as const] : [])].map(([name, list]) => ({ name, skills: list }));
}

/** The groups to show: null when "Disable groups" is on or nothing is grouped. */
export function shownSkillGroups(profile: Pick<ProfileData, "skills" | "groupSkills">): SkillGroup[] | null {
  return profile.groupSkills === false ? null : groupSkills(profile.skills);
}

/** Skills as resume text: one "Group: a · b" line per group, or "a · b" when not grouped. */
export function skillsText(skills: readonly { name: string; group?: string }[], grouped = true): string {
  const groups = grouped ? groupSkills(skills) : null;
  return groups
    ? groups.map((group) => `${group.name}: ${group.skills.map((skill) => skill.name).join(" · ")}`).join("\n")
    : skills.map((skill) => skill.name).join(" · ");
}

/** Skills text as lines of an optional group name and its skills (a flat list has one line, no name). */
export function parseSkillsText(text: string): { group: string | null; skills: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colon = line.indexOf(": ");
      return colon > 0 && !line.slice(0, colon).includes(" · ")
        ? { group: line.slice(0, colon), skills: line.slice(colon + 2) }
        : { group: null, skills: line };
    });
}

/** The skill names in skills text, grouped or not. */
export function skillNamesIn(text: string): string[] {
  return parseSkillsText(text).flatMap((line) => line.skills.split(" · ")).map((name) => name.trim()).filter(Boolean);
}
export type LanguageItem = { id: string; name: string; level: LanguageLevel };
export type ExperienceItem = DateSpan & {
  id: string;
  role: string;
  company: string;
  location: string;
  jobType: string;
  bullets: string;
  skillIds: string[];
};
/** A project (PRO-13): what was built, where to see it, and the skills used, like a role. */
export type ProjectItem = DateSpan & {
  id: string;
  name: string;
  link: string;
  /** What it was part of: "" (none), "experience:<id>", "education:<id>" or "other:<kind>". */
  association: string;
  bullets: string;
  skillIds: string[];
};
export type EducationItem = DateSpan & { id: string; degree: string; school: string; notes: string };
/** A publication (#218): the citation as written, with **bold** and *italic*, and where to read it. */
export type PublicationItem = { id: string; citation: string; link: string; onResumes: boolean };
/** A licence or certification: issued (and maybe expiring) month and year, and where to check it. */
export type CertificationItem = {
  id: string;
  name: string;
  issuer: string;
  issueYear: number | null;
  issueMonth: number | null;
  expiryYear: number | null;
  expiryMonth: number | null;
  credentialId: string;
  credentialUrl: string;
};
export type ReferenceItem = {
  id: string;
  name: string;
  relation: string;
  company: string;
  email: string;
  phone: string;
};
/** A fact the user tells the AI (PRO-14): about themselves, or for one application. */
export type FactItem = { id: string; text: string };
export type ProfileData = {
  basics: Basics;
  /** The photo for resumes (#224); null without one. Never given to the AI. */
  photo: ProfilePhoto | null;
  skills: SkillItem[];
  /** Whether skills show in their groups; false (Settings) shows one list. Missing means yes. */
  groupSkills?: boolean;
  /** Whether adding a skill groups them again (Settings). */
  autoGroupSkills?: boolean;
  languages: LanguageItem[];
  experience: ExperienceItem[];
  projects: ProjectItem[];
  education: EducationItem[];
  /** In the order set by hand, with the ones kept off resumes too. */
  publications: PublicationItem[];
  certifications: CertificationItem[];
  references: ReferenceItem[];
  /** "Facts about me": never on a document, only given to the AI. */
  facts: FactItem[];
};

/** The facts worth sending: trimmed, without empty ones. */
export function factTexts(facts: { text: string }[]): string[] {
  return facts.map((fact) => fact.text.trim()).filter(Boolean);
}

/** The certifications a resume shows: those with a name. */
export function resumeCertifications(certifications: readonly CertificationItem[]): CertificationItem[] {
  return certifications.filter((entry) => entry.name.trim() !== "");
}

/** A certification as one resume line: "AWS Certified Developer, Amazon Web Services, Dec 2023 – Dec 2026". */
export function certificationLine(entry: CertificationItem, options: DateFormatOptions = {}): string {
  const issued = formatMonthYear(entry.issueYear, entry.issueMonth, options);
  const expires = formatMonthYear(entry.expiryYear, entry.expiryMonth, options);
  return [entry.name.trim(), entry.issuer.trim(), [issued, expires].filter(Boolean).join(" – ")].filter(Boolean).join(", ");
}

/** The publications a resume shows: those with "Show on resumes" on and a citation. */
export function resumePublications(publications: readonly PublicationItem[]): PublicationItem[] {
  return publications.filter((entry) => entry.onResumes && entry.citation.trim() !== "");
}

/** How many required Basics fields have something in them. */
export function filledBasics(basics: Record<BasicsField, string>): number {
  return REQUIRED_BASICS.filter((field) => basics[field].trim() !== "").length;
}

/** Age in whole years on `today`, from a "YYYY-MM-DD" date of birth; null without a valid one. */
export function ageOn(dob: string, today: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  let age = today.getFullYear() - year;
  const beforeBirthday =
    today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

/**
 * Profile strength (PRO-9): filled required Basics fields ÷ 6 × 40, plus 30
 * for any experience, 15 for any education and 15 for any skills. Optional
 * sections and fields don't count (#216), so it reaches 100% without them.
 */
export function profileStrength(profile: {
  basics: Record<BasicsField, string>;
  experience: number;
  education: number;
  skills: number;
}): { percent: number; hint: string } {
  const percent = Math.round(
    (filledBasics(profile.basics) / REQUIRED_BASICS.length) * 40 +
      (profile.experience > 0 ? 30 : 0) +
      (profile.education > 0 ? 15 : 0) +
      (profile.skills > 0 ? 15 : 0),
  );
  const hint =
    percent === 100
      ? "All set. The optional sections are there if they help."
      : percent >= 90
        ? "Looking great. The AI has plenty to work with."
        : percent >= 50
          ? "Nice progress. A bit more detail makes tailoring sharper."
          : "A good start. Experience matters most.";
  return { percent, hint };
}

/**
 * Orders entries newest first by start date (entries without one go last),
 * then by their `sort` value.
 */
export function byStartDateDesc(
  a: DateSpan & { sort: number },
  b: DateSpan & { sort: number },
): number {
  const key = (entry: DateSpan) =>
    entry.startYear === null ? -Infinity : entry.startYear * 12 + (entry.startMonth ?? 0);
  return key(b) - key(a) || a.sort - b.sort;
}

/** How experience, projects and education are ordered (E4-9): by date until an entry is moved by hand. */
export type EntryOrder = "date" | "manual";

/** The entries in the section's order, as a new array. */
export function inEntryOrder<T extends DateSpan & { sort: number }>(entries: readonly T[], order: EntryOrder): T[] {
  return entries.toSorted(order === "manual" ? (a, b) => a.sort - b.sort : byStartDateDesc);
}

/** Whether two skill or language names are the same, ignoring case ("Figma" and "figma"). */
export function sameName(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), undefined, { sensitivity: "accent" }) === 0;
}

/** Months of experience in the profile, counting overlapping roles once. */
export function experienceMonths(profile: Pick<ProfileData, "experience">, today: Date): number {
  const now = today.getFullYear() * 12 + today.getMonth();
  const months = new Set<number>();
  for (const entry of profile.experience) {
    if (entry.startYear === null) continue;
    const start = entry.startYear * 12 + (entry.startMonth ?? 1) - 1;
    const end = entry.current
      ? now
      : entry.endYear !== null
        ? entry.endYear * 12 + (entry.endMonth ?? 12) - 1
        : start;
    for (let month = start; month <= Math.min(end, now); month++) months.add(month);
  }
  return months.size;
}

/** "Engineer at Acme", or "" for a role not filled in yet. */
export const experienceLabel = (entry: { role: string; company: string }) =>
  [entry.role.trim(), entry.company.trim()].filter(Boolean).join(" at ");
/** "BSc Computing, Imperial", or "" for a degree not filled in yet. */
export const educationLabel = (entry: { degree: string; school: string }) =>
  [entry.degree.trim(), entry.school.trim()].filter(Boolean).join(", ");

/**
 * A project's association in words: the role, the degree or the other kind
 * it was part of, or "" for none. A role or degree that was deleted, or isn't filled in, reads as none.
 */
export function associationLabel(association: string, profile: Pick<ProfileData, "experience" | "education">): string {
  const [, kind, value] = /^(experience|education|other):([^]+)$/.exec(association) ?? [];
  if (kind === "experience") {
    const entry = profile.experience.find((item) => item.id === value);
    return entry ? experienceLabel(entry) : "";
  }
  if (kind === "education") {
    const entry = profile.education.find((item) => item.id === value);
    return entry ? educationLabel(entry) : "";
  }
  return kind === "other" ? value : "";
}
