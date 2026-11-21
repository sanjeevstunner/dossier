import { z } from "zod";

// The Naukri profile as Dossier can tailor and update it through NopeRi
// (GET /api/profile/editable, PATCH /api/profile), shared by the server and
// the "Naukri profile" screen: the fields, every list section with what its
// editor shows, and how accepted changes become one update. The limits are
// Naukri's own.

export const HEADLINE_MAX = 250;
export const SUMMARY_MAX = 1000;
export const KEY_SKILLS_MAX = 50;
/** Naukri stores key skills comma-joined and rejects more than 250 characters in all. */
export const KEY_SKILLS_CHARS = 250;

/** The skills, in order, that fit in KEY_SKILLS_CHARS once comma-joined; the rest are left out. */
export function fitKeySkills(skills: string[]): string[] {
  const kept: string[] = [];
  for (const skill of skills) if ([...kept, skill].join(",").length <= KEY_SKILLS_CHARS) kept.push(skill);
  return kept;
}
export const DESIRED_ROLES_MAX = 3;
export const LOCATIONS_MAX = 10;

/** Naukri's notice periods, by the id its profile saves. */
export const NOTICE_PERIODS: { id: number; label: string }[] = [
  { id: 1, label: "15 days or less" },
  { id: 2, label: "1 month" },
  { id: 3, label: "2 months" },
  { id: 4, label: "3 months" },
  { id: 5, label: "More than 3 months" },
  { id: 6, label: "Serving notice period" },
];

/** A city or role with Naukri's numeric id, or one of its dropdown options. */
export const tagSchema = z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(200) });
export type NaukriTag = z.output<typeof tagSchema>;

/** A company, designation, skill, institute or certificate: Naukri's id, or null for free text. */
export const refSchema = z.object({ id: z.string().min(1).nullable().catch(null), name: z.string().catch("") });
export type NaukriRef = z.output<typeof refSchema>;

export const salarySchema = z.object({ amount: z.number().int().positive().max(1_000_000_000), currency: z.string().length(3) });
export type Salary = z.output<typeof salarySchema>;

const s = z.string().catch("");
const month = z.string().nullable().catch(null);
const year = z.number().int().nullable().catch(null);
const id = z.string().optional();
const optionalTag = tagSchema.nullable().catch(null);
const duration = z.object({ years: z.number().int().min(0).catch(0), months: z.number().int().min(0).max(11).catch(0) });

/** Each list section's items, as NopeRi reads and saves them; `id` is missing on one being added. */
export const ITEM_SCHEMAS = {
  employments: z.object({
    id,
    current: z.boolean().catch(false),
    designation: refSchema,
    company: refSchema,
    start: s,
    end: month,
    description: s,
    skills: z.array(z.string()).catch([]),
    experienceType: z.enum(["F", "I"]).catch("F"),
  }),
  itSkills: z.object({ id, skill: refSchema, version: s, lastUsed: year, experience: duration }),
  educations: z.object({
    id,
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).catch(1),
    course: tagSchema.catch({ id: 1, name: "" }),
    specialisation: tagSchema.catch({ id: 1, name: "" }),
    institute: refSchema,
    courseType: z.enum(["F", "P", "C"]).catch("F"),
    startYear: year,
    endYear: year,
    grade: optionalTag,
    marks: s,
    primary: z.boolean().catch(false),
  }),
  projects: z.object({ id, title: s, client: s, details: s, skills: s, role: s, start: s, end: month }),
  onlineProfiles: z.object({ id, name: s, url: s, description: s }),
  workSamples: z.object({ id, title: s, url: s, description: s, start: month, end: month }),
  publications: z.object({ id, title: s, url: s, description: s, published: month }),
  presentations: z.object({ id, title: s, url: s, description: s }),
  patents: z.object({ id, title: s, url: s, description: s, applicationNumber: s, office: s, status: z.string().catch("a"), issued: month }),
  certifications: z.object({ id, name: refSchema, url: s, issued: month, expires: month }),
  languages: z.object({
    id,
    language: s,
    languageRef: z.string().nullable().catch(null),
    proficiency: z.union([z.literal(1), z.literal(2), z.literal(3)]).catch(2),
    read: z.boolean().catch(true),
    write: z.boolean().catch(true),
    speak: z.boolean().catch(true),
  }),
};

export type SectionName = keyof typeof ITEM_SCHEMAS;
export type SectionItem<K extends SectionName = SectionName> = z.output<(typeof ITEM_SCHEMAS)[K]>;
export const SECTION_NAMES = Object.keys(ITEM_SCHEMAS) as SectionName[];

export const basicsSchema = z.object({
  name: s,
  city: optionalTag,
  experience: duration,
  currentSalary: salarySchema.nullable().catch(null),
});
export type Basics = z.output<typeof basicsSchema>;

export const personalSchema = z.object({
  birthDate: z.string().nullable().catch(null),
  gender: z.enum(["M", "F"]).nullable().catch(null),
  address: s,
  hometown: s,
  pincode: s,
  maritalStatus: z.enum(["N", "M", "W", "D", "S", "O"]).nullable().catch(null),
});
export type Personal = z.output<typeof personalSchema>;

const sectionsShape = Object.fromEntries(SECTION_NAMES.map((name) => [name, z.array(ITEM_SCHEMAS[name]).catch([])])) as {
  [K in SectionName]: z.ZodCatch<z.ZodArray<(typeof ITEM_SCHEMAS)[K]>>;
};

/** The whole profile as it is on Naukri now. */
export const editableSchema = z.object({
  headline: s,
  summary: s,
  keySkills: z.array(z.string()).catch([]),
  desiredRoles: z.array(tagSchema).catch([]),
  preferredLocations: z.array(tagSchema).catch([]),
  expectedSalary: salarySchema.nullable().catch(null),
  noticePeriodId: z.number().int().nullable().catch(null),
  basics: basicsSchema.catch({ name: "", city: null, experience: { years: 0, months: 0 }, currentSalary: null }),
  personal: personalSchema.catch({ birthDate: null, gender: null, address: "", hometown: "", pincode: "", maritalStatus: null }),
  ...sectionsShape,
});
export type NaukriEditable = z.output<typeof editableSchema>;

/** What an update may change; only what's given is sent. Items are checked with `itemProblem` too. */
export const updateSchema = z
  .object({
    headline: z.string().trim().min(1).max(HEADLINE_MAX),
    summary: z.string().trim().min(1).max(SUMMARY_MAX),
    keySkills: z
      .array(z.string().trim().min(1).max(100))
      .min(1)
      .max(KEY_SKILLS_MAX)
      .refine((skills) => skills.join(",").length <= KEY_SKILLS_CHARS, `Key skills: at most ${KEY_SKILLS_CHARS} characters in all, commas included. Remove a few.`),
    desiredRoles: z.array(tagSchema).min(1).max(DESIRED_ROLES_MAX),
    preferredLocations: z.array(tagSchema).min(1).max(LOCATIONS_MAX),
    expectedSalary: salarySchema,
    noticePeriodId: z.number().int().refine((value) => NOTICE_PERIODS.some((period) => period.id === value), "Unknown notice period"),
    // Strict, unlike the reading schemas: a bad value must fail, not quietly become empty and clear the field on Naukri.
    basics: z
      .object({
        name: z.string().trim().min(1).max(100),
        city: tagSchema,
        experience: z.object({ years: z.number().int().min(0).max(50), months: z.number().int().min(0).max(11) }),
        currentSalary: salarySchema,
      })
      .partial(),
    personal: z
      .object({
        birthDate: z.iso.date().nullable(),
        gender: z.enum(["M", "F"]).nullable(),
        address: z.string().trim().max(500),
        hometown: z.string().trim().max(100),
        pincode: z.union([z.string().regex(/^\d{6}$/), z.literal("")]),
        maritalStatus: z.enum(["N", "M", "W", "D", "S", "O"]).nullable(),
      })
      .partial(),
    sections: z.object(Object.fromEntries(SECTION_NAMES.map((name) => [name, z.array(ITEM_SCHEMAS[name]).max(50)]))).partial(),
    remove: z.array(z.object({ section: z.enum(SECTION_NAMES as [SectionName, ...SectionName[]]), id: z.string().min(1) })).max(100),
  })
  .partial()
  .refine((fields) => Object.values(fields).some((value) => value !== undefined), "Choose at least one change.");
export type NaukriUpdate = z.output<typeof updateSchema>;

// What the screen edits: the single fields, and the list sections' items.

export type FieldKey = "headline" | "keySkills" | "summary" | "desiredRoles" | "preferredLocations" | "expectedSalary" | "noticePeriodId" | "basics" | "personal";

/** The single fields in the order the screen shows them, with their names. */
export const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "headline", label: "Resume headline" },
  { key: "keySkills", label: "Key skills" },
  { key: "summary", label: "Profile summary" },
  { key: "basics", label: "Basic details" },
  { key: "desiredRoles", label: "Desired roles" },
  { key: "preferredLocations", label: "Preferred locations" },
  { key: "expectedSalary", label: "Expected salary" },
  { key: "noticePeriodId", label: "Notice period" },
  { key: "personal", label: "Personal details" },
];

/** Things NopeRi looks up Naukri's ids for. */
export type LookupType = "location" | "designation" | "company" | "institute" | "skill" | "certification";
/** Naukri's dropdowns NopeRi serves. */
export type OptionList = "UGCOURSE" | "PGCOURSE" | "PPGCOURSE" | "UGSPEC" | "PGSPEC" | "PPGSPEC" | "GRADING_SYSTEM";

/** Naukri's marital status codes (the only values its profile takes), with their labels. */
export const MARITAL_STATUSES = [
  { value: "N", label: "Single/unmarried" },
  { value: "M", label: "Married" },
  { value: "W", label: "Widowed" },
  { value: "D", label: "Divorced" },
  { value: "S", label: "Separated" },
  { value: "O", label: "Other" },
] as const;
export type NaukriOption = { id: number; name: string; parentId: number };

const LEVEL_LISTS: Record<number, { course: OptionList; spec: OptionList }> = {
  1: { course: "UGCOURSE", spec: "UGSPEC" },
  2: { course: "PGCOURSE", spec: "PGSPEC" },
  3: { course: "PPGCOURSE", spec: "PPGSPEC" },
};
export const courseList = (level: number) => LEVEL_LISTS[level]?.course ?? "UGCOURSE";
export const specList = (level: number) => LEVEL_LISTS[level]?.spec ?? "UGSPEC";

/** One input of an item editor. `optional` ones may be empty. */
export type FieldSpec = { key: string; label: string; optional?: boolean; max?: number } & (
  | { kind: "text" | "textarea" | "url" | "month" | "year" | "skills" | "check" | "duration" }
  | { kind: "ref"; lookup: LookupType }
  | { kind: "choice"; choices: { value: string | number; label: string }[] }
  /** A dropdown of Naukri's: `list` picks it from the item, `parent` keeps options under another field's id. */
  | { kind: "option"; list: (item: Record<string, unknown>) => OptionList; parent?: string }
);

/** Each list section: its name, how an item reads in one line, and its editor. */
export const SECTIONS: Record<SectionName, { label: string; noun: string; line: (item: never) => string; fields: FieldSpec[]; blank: () => SectionItem }> = {
  employments: {
    label: "Employment",
    noun: "employment",
    line: (item: SectionItem<"employments">) => `${item.designation.name} at ${item.company.name} (${item.start || "?"} – ${item.current ? "present" : (item.end ?? "?")})`,
    fields: [
      { key: "designation", label: "Designation", kind: "ref", lookup: "designation" },
      { key: "company", label: "Company", kind: "ref", lookup: "company" },
      { key: "current", label: "This is my current job", kind: "check" },
      { key: "start", label: "Started (YYYY-MM)", kind: "month" },
      { key: "end", label: "Ended (YYYY-MM)", kind: "month", optional: true },
      { key: "description", label: "Job profile", kind: "textarea", optional: true, max: 4000 },
      { key: "skills", label: "Skills used", kind: "skills", optional: true },
    ],
    blank: () => ({ current: false, designation: { id: null, name: "" }, company: { id: null, name: "" }, start: "", end: null, description: "", skills: [], experienceType: "F" }),
  },
  itSkills: {
    label: "IT skills",
    noun: "IT skill",
    line: (item: SectionItem<"itSkills">) =>
      [item.skill.name, item.version && `v${item.version}`, item.lastUsed && `last used ${item.lastUsed}`, `${item.experience.years}y ${item.experience.months}m`].filter(Boolean).join(" · "),
    fields: [
      { key: "skill", label: "Skill / software", kind: "ref", lookup: "skill" },
      { key: "version", label: "Version", kind: "text", optional: true, max: 20 },
      { key: "lastUsed", label: "Last used (year)", kind: "year", optional: true },
      { key: "experience", label: "Experience", kind: "duration" },
    ],
    blank: () => ({ skill: { id: null, name: "" }, version: "", lastUsed: null, experience: { years: 0, months: 0 } }),
  },
  educations: {
    label: "Education",
    noun: "education",
    line: (item: SectionItem<"educations">) => `${item.course.name}, ${item.specialisation.name} · ${item.institute.name} (${item.startYear ?? "?"}–${item.endYear ?? "?"})`,
    fields: [
      { key: "level", label: "Education", kind: "choice", choices: [{ value: 1, label: "Graduation/Diploma" }, { value: 2, label: "Masters/Post-Graduation" }, { value: 3, label: "Doctorate/PhD" }] },
      { key: "course", label: "Course", kind: "option", list: (item) => courseList(Number(item.level)) },
      { key: "specialisation", label: "Specialisation", kind: "option", list: (item) => specList(Number(item.level)), parent: "course" },
      { key: "institute", label: "University / institute", kind: "ref", lookup: "institute" },
      { key: "courseType", label: "Course type", kind: "choice", choices: [{ value: "F", label: "Full time" }, { value: "P", label: "Part time" }, { value: "C", label: "Distance learning" }] },
      { key: "startYear", label: "Started (year)", kind: "year" },
      { key: "endYear", label: "Finished (year)", kind: "year" },
      { key: "grade", label: "Grading system", kind: "option", list: () => "GRADING_SYSTEM", optional: true },
      { key: "marks", label: "Marks", kind: "text", optional: true, max: 10 },
    ],
    blank: () => ({ level: 1, course: { id: 1, name: "" }, specialisation: { id: 1, name: "" }, institute: { id: null, name: "" }, courseType: "F", startYear: null, endYear: null, grade: null, marks: "", primary: false }),
  },
  projects: {
    label: "Projects",
    noun: "project",
    line: (item: SectionItem<"projects">) => `${item.title} · ${item.client} (${item.start || "?"} – ${item.end ?? "ongoing"})`,
    fields: [
      { key: "title", label: "Project title", kind: "text", max: 250 },
      { key: "client", label: "Client", kind: "text", max: 250 },
      { key: "role", label: "Your role", kind: "text", optional: true, max: 250 },
      { key: "start", label: "Started (YYYY-MM)", kind: "month" },
      { key: "end", label: "Finished (YYYY-MM, empty if ongoing)", kind: "month", optional: true },
      { key: "skills", label: "Skills used", kind: "text", optional: true, max: 500 },
      { key: "details", label: "Details", kind: "textarea", optional: true, max: 4000 },
    ],
    blank: () => ({ title: "", client: "", details: "", skills: "", role: "", start: "", end: null }),
  },
  onlineProfiles: {
    label: "Online profiles",
    noun: "online profile",
    line: (item: SectionItem<"onlineProfiles">) => `${item.name}: ${item.url}`,
    fields: [
      { key: "name", label: "Social profile", kind: "text", max: 100 },
      { key: "url", label: "URL", kind: "url" },
      { key: "description", label: "Description", kind: "textarea", optional: true, max: 500 },
    ],
    blank: () => ({ name: "", url: "", description: "" }),
  },
  workSamples: {
    label: "Work samples",
    noun: "work sample",
    line: (item: SectionItem<"workSamples">) => `${item.title}: ${item.url}`,
    fields: [
      { key: "title", label: "Title", kind: "text", max: 250 },
      { key: "url", label: "URL", kind: "url" },
      { key: "start", label: "Started (YYYY-MM)", kind: "month", optional: true },
      { key: "end", label: "Finished (YYYY-MM)", kind: "month", optional: true },
      { key: "description", label: "Description", kind: "textarea", optional: true, max: 1000 },
    ],
    blank: () => ({ title: "", url: "", description: "", start: null, end: null }),
  },
  publications: {
    label: "Publications",
    noun: "publication",
    line: (item: SectionItem<"publications">) => item.title,
    fields: [
      { key: "title", label: "Title", kind: "text", max: 250 },
      { key: "url", label: "URL", kind: "url", optional: true },
      { key: "published", label: "Published (YYYY-MM)", kind: "month", optional: true },
      { key: "description", label: "Description", kind: "textarea", optional: true, max: 1000 },
    ],
    blank: () => ({ title: "", url: "", description: "", published: null }),
  },
  presentations: {
    label: "Presentations",
    noun: "presentation",
    line: (item: SectionItem<"presentations">) => `${item.title}: ${item.url}`,
    fields: [
      { key: "title", label: "Title", kind: "text", max: 250 },
      { key: "url", label: "URL", kind: "url" },
      { key: "description", label: "Description", kind: "textarea", optional: true, max: 1000 },
    ],
    blank: () => ({ title: "", url: "", description: "" }),
  },
  patents: {
    label: "Patents",
    noun: "patent",
    line: (item: SectionItem<"patents">) => `${item.title} (${item.status === "a" ? "issued" : "pending"})`,
    fields: [
      { key: "title", label: "Title", kind: "text", max: 250 },
      { key: "url", label: "URL", kind: "url", optional: true },
      { key: "office", label: "Patent office", kind: "text", optional: true, max: 100 },
      { key: "status", label: "Status", kind: "choice", choices: [{ value: "a", label: "Issued" }, { value: "p", label: "Pending" }] },
      { key: "applicationNumber", label: "Application number", kind: "text", optional: true, max: 50 },
      { key: "issued", label: "Issued (YYYY-MM)", kind: "month", optional: true },
      { key: "description", label: "Description", kind: "textarea", optional: true, max: 1000 },
    ],
    blank: () => ({ title: "", url: "", description: "", applicationNumber: "", office: "", status: "a", issued: null }),
  },
  certifications: {
    label: "Certifications",
    noun: "certification",
    line: (item: SectionItem<"certifications">) => [item.name.name, item.issued && `issued ${item.issued}`].filter(Boolean).join(" · "),
    fields: [
      { key: "name", label: "Certification", kind: "ref", lookup: "certification" },
      { key: "url", label: "Certification URL", kind: "url", optional: true },
      { key: "issued", label: "Issued (YYYY-MM)", kind: "month", optional: true },
      { key: "expires", label: "Expires (YYYY-MM)", kind: "month", optional: true },
    ],
    blank: () => ({ name: { id: null, name: "" }, url: "", issued: null, expires: null }),
  },
  languages: {
    label: "Languages",
    noun: "language",
    line: (item: SectionItem<"languages">) =>
      `${item.language} · ${["", "Beginner", "Proficient", "Expert"][item.proficiency]} · ${(["read", "write", "speak"] as const).filter((ability) => item[ability]).join(", ")}`,
    fields: [
      { key: "language", label: "Language", kind: "text", max: 50 },
      { key: "proficiency", label: "Proficiency", kind: "choice", choices: [{ value: 1, label: "Beginner" }, { value: 2, label: "Proficient" }, { value: 3, label: "Expert" }] },
      { key: "read", label: "Read", kind: "check" },
      { key: "write", label: "Write", kind: "check" },
      { key: "speak", label: "Speak", kind: "check" },
    ],
    blank: () => ({ language: "", languageRef: null, proficiency: 2, read: true, write: true, speak: true }),
  },
};

/** The editors of the two grouped single fields. */
export const BASICS_FIELDS: FieldSpec[] = [
  { key: "name", label: "Full name", kind: "text", max: 100 },
  { key: "city", label: "Current city", kind: "ref", lookup: "location", optional: true },
  { key: "experience", label: "Total experience", kind: "duration" },
];
export const PERSONAL_FIELDS: FieldSpec[] = [
  { key: "birthDate", label: "Date of birth (YYYY-MM-DD)", kind: "text", optional: true, max: 10 },
  { key: "gender", label: "Gender", kind: "choice", choices: [{ value: "M", label: "Male" }, { value: "F", label: "Female" }], optional: true },
  { key: "maritalStatus", label: "Marital status", kind: "choice", choices: [...MARITAL_STATUSES], optional: true },
  { key: "address", label: "Permanent address", kind: "textarea", optional: true, max: 500 },
  { key: "hometown", label: "Hometown", kind: "text", optional: true, max: 100 },
  { key: "pincode", label: "Pincode", kind: "text", optional: true, max: 6 },
];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const empty = (value: unknown) =>
  value === null || value === undefined || value === "" || (typeof value === "object" && "name" in (value as object) && !String((value as { name: unknown }).name).trim());

/** What's wrong with an item or grouped field for Naukri, in words; null when it can be saved. */
export function itemProblem(fields: FieldSpec[], item: Record<string, unknown>): string | null {
  for (const field of fields) {
    const value = item[field.key];
    if (empty(value)) {
      if (field.optional || field.kind === "check" || field.kind === "skills" || field.kind === "duration") continue;
      return `${field.label} is needed.`;
    }
    if (field.kind === "month" && !MONTH.test(String(value))) return `${field.label}: use YYYY-MM.`;
    if (field.kind === "year" && !(Number(value) >= 1950 && Number(value) <= 2100)) return `${field.label}: use a year.`;
    if (field.kind === "url" && !/^https?:\/\/\S+$/.test(String(value))) return `${field.label}: use a full address starting with https://.`;
    if (field.max && typeof value === "string" && value.length > field.max) return `${field.label}: at most ${field.max} characters.`;
  }
  if (item.current === false && "end" in item && !item.end) return "Ended is needed for a past job.";
  return null;
}

// Changes: the screen shows current and suggested side by side and sends what's accepted.

/** A list item's key: "employments:<id>", or "employments:new-3" for one being added. */
export const itemKey = (section: SectionName, item: { id?: string }) => `${section}:${item.id}`;
export const isNew = (item: { id?: string }) => !item.id || item.id.startsWith("new-");

const normalised = (value: unknown): unknown =>
  JSON.stringify(value, (_, inner) => (typeof inner === "string" ? inner.trim().toLowerCase() : inner && typeof inner === "object" && "name" in inner && "id" in inner ? String(inner.name).trim().toLowerCase() : inner));

/** Whether two values differ for Naukri (names compared without case or surrounding spaces). */
export const same = (a: unknown, b: unknown) => normalised(a) === normalised(b);

/** Whether a single field's suggested value differs from the current one. */
export function differs(field: FieldKey, current: NaukriEditable, suggested: NaukriEditable): boolean {
  return !same(current[field], suggested[field]);
}

/**
 * The update for what's accepted: single fields by key, list items by
 * itemKey (an added one without its temporary id), and the items to delete.
 */
export function updateOf(values: NaukriEditable, accepted: ReadonlySet<string>, removed: ReadonlySet<string> = new Set()): NaukriUpdate {
  const update: NaukriUpdate = {};
  for (const { key } of FIELDS) {
    const value = values[key];
    if (!accepted.has(key) || value === null || value === undefined) continue;
    // A city or current salary Naukri has none of stays as it is rather than being sent empty.
    (update as Record<string, unknown>)[key] =
      typeof value === "string" ? value.trim() : key === "basics" ? Object.fromEntries(Object.entries(value).filter(([, part]) => part !== null)) : value;
  }
  const sections: Record<string, unknown[]> = {};
  const remove: { section: SectionName; id: string }[] = [];
  for (const name of SECTION_NAMES) {
    for (const item of values[name] as SectionItem[]) {
      const key = itemKey(name, item);
      if (removed.has(key)) {
        if (!isNew(item)) remove.push({ section: name, id: item.id! });
      } else if (accepted.has(key)) {
        (sections[name] ??= []).push(isNew(item) ? { ...item, id: undefined } : item);
      }
    }
  }
  if (Object.keys(sections).length) update.sections = sections as NaukriUpdate["sections"];
  if (remove.length) update.remove = remove;
  return update;
}

/** "₹15,00,000 a year" style, in the currency's own grouping. */
export function salaryText(salary: Salary | null): string {
  if (!salary) return "Not set";
  try {
    return `${new Intl.NumberFormat("en-IN", { style: "currency", currency: salary.currency, maximumFractionDigits: 0 }).format(salary.amount)} a year`;
  } catch {
    return `${salary.amount} ${salary.currency} a year`;
  }
}

export const noticeText = (value: number | null) => NOTICE_PERIODS.find((period) => period.id === value)?.label ?? "Not set";

/** A suggested profile: every field and section, why the AI changed what it changed, and names Naukri didn't know. */
export type Suggestion = NaukriEditable & { reasons: Partial<Record<FieldKey | SectionName, string>>; unresolved: string[] };

/** What the AI can write: the words of the profile, never its facts. */
export const AI_KEYS = ["headline", "summary", "keySkills", "desiredRoles", "employments", "itSkills", "projects", "educations", "certifications", "publications", "workSamples"] as const;
export type AiKey = (typeof AI_KEYS)[number];

/** Whether a change key ("headline", "employments:42") belongs to one of these fields or sections. */
export const keyIn = (key: string, names: readonly string[]) => names.includes(key.split(":")[0]!);

/**
 * The values to keep editing after an update: what was sent comes back as
 * Naukri saved it; everything not sent (suggestions still under review in
 * other sections) stays as it was on the screen.
 */
export function afterUpdate(values: NaukriEditable, saved: NaukriEditable, sent: ReadonlySet<string>, removed: ReadonlySet<string>): NaukriEditable {
  const next = { ...saved } as Record<string, unknown>;
  for (const { key } of FIELDS) if (!sent.has(key)) next[key] = values[key];
  for (const name of SECTION_NAMES) {
    const mine = values[name] as SectionItem[];
    const kept = (saved[name] as SectionItem[]).map((item) => {
      const twin = mine.find((other) => other.id === item.id);
      const key = itemKey(name, item);
      return twin && !sent.has(key) && !removed.has(key) ? twin : item;
    });
    const pending = mine.filter((item) => isNew(item) && !sent.has(itemKey(name, item)) && !removed.has(itemKey(name, item)));
    next[name] = [...kept, ...pending];
  }
  return next as NaukriEditable;
}
