import { z } from "zod";

// The Naukri profile fields Dossier can tailor and update through NopeRi
// (GET /api/profile/editable, PATCH /api/profile), shared by the server and
// the "Naukri profile" screen. The limits are Naukri's own.

export const HEADLINE_MAX = 250;
export const SUMMARY_MAX = 1000;
export const KEY_SKILLS_MAX = 50;
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

/** A city or designation with Naukri's id for it. */
export const tagSchema = z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(200) });
export type NaukriTag = z.output<typeof tagSchema>;

export const salarySchema = z.object({ amount: z.number().int().positive().max(1_000_000_000), currency: z.string().length(3) });
export type Salary = z.output<typeof salarySchema>;

/** The fields as they are on Naukri now. */
export const editableSchema = z.object({
  headline: z.string().catch(""),
  summary: z.string().catch(""),
  keySkills: z.array(z.string()).catch([]),
  desiredRoles: z.array(tagSchema).catch([]),
  preferredLocations: z.array(tagSchema).catch([]),
  expectedSalary: salarySchema.nullable().catch(null),
  noticePeriodId: z.number().int().nullable().catch(null),
});
export type NaukriEditable = z.output<typeof editableSchema>;

/** What an update may change; only the fields given are sent. */
export const updateSchema = z
  .object({
    headline: z.string().trim().min(1).max(HEADLINE_MAX),
    summary: z.string().trim().min(1).max(SUMMARY_MAX),
    keySkills: z.array(z.string().trim().min(1).max(100)).min(1).max(KEY_SKILLS_MAX),
    desiredRoles: z.array(tagSchema).min(1).max(DESIRED_ROLES_MAX),
    preferredLocations: z.array(tagSchema).min(1).max(LOCATIONS_MAX),
    expectedSalary: salarySchema,
    noticePeriodId: z.number().int().refine((id) => NOTICE_PERIODS.some((period) => period.id === id), "Unknown notice period"),
  })
  .partial()
  .refine((fields) => Object.values(fields).some((value) => value !== undefined), "Choose at least one change.");
export type NaukriUpdate = z.output<typeof updateSchema>;

export type FieldKey = keyof NaukriEditable;

/** The fields in the order the screen shows them, with their names. */
export const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "headline", label: "Resume headline" },
  { key: "keySkills", label: "Key skills" },
  { key: "summary", label: "Profile summary" },
  { key: "desiredRoles", label: "Desired roles" },
  { key: "preferredLocations", label: "Preferred locations" },
  { key: "expectedSalary", label: "Expected salary" },
  { key: "noticePeriodId", label: "Notice period" },
];

/** A suggested profile: every field, plus why the AI changed the ones it wrote, and names Naukri didn't know. */
export type Suggestion = NaukriEditable & { reasons: Partial<Record<FieldKey, string>>; unresolved: string[] };

const key = (value: unknown) =>
  JSON.stringify(value, (_, inner) => (inner && typeof inner === "object" && "name" in inner ? String(inner.name).toLowerCase() : inner));

/** Whether a field's suggested value differs from the current one (names compared without case). */
export function differs(field: FieldKey, current: NaukriEditable, suggested: NaukriEditable): boolean {
  const normalise = (value: unknown) => (typeof value === "string" ? value.trim() : field === "keySkills" ? (value as string[]).map((skill) => skill.toLowerCase()) : value);
  return key(normalise(current[field])) !== key(normalise(suggested[field]));
}

/** The update for the accepted fields of `values`. */
export function updateOf(values: NaukriEditable, accepted: FieldKey[]): NaukriUpdate {
  const update: NaukriUpdate = {};
  for (const field of accepted) {
    const value = values[field];
    if (value === null || value === undefined) continue;
    (update as Record<string, unknown>)[field] = typeof value === "string" ? value.trim() : value;
  }
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

export const noticeText = (id: number | null) => NOTICE_PERIODS.find((period) => period.id === id)?.label ?? "Not set";
