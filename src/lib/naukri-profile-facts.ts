import type { NaukriEditable, SectionItem } from "./naukri-profile";
import { experienceMonths, type ProfileData } from "./profile";

// What the Dossier profile says for the Naukri fields that are facts rather
// than writing (no AI): total experience, personal details, the LinkedIn and
// website links, and languages. The city's Naukri id is looked up after.

const PROFICIENCY: Record<string, 1 | 2 | 3> = { NATIVE: 3, C2: 3, C1: 3, B2: 2, B1: 2, A2: 1, A1: 1 };
const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const sameUrl = (a: string, b: string) => a.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "").toLowerCase() === b.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "").toLowerCase();

/** `current` with the Dossier profile's facts filled in, and the city name to look up (null to keep Naukri's). */
export function withProfileFacts(current: NaukriEditable, profile: ProfileData, today: Date): { values: NaukriEditable; city: string | null } {
  const { basics } = profile;
  const months = experienceMonths(profile, today);
  const experience = months > 0 ? { years: Math.floor(months / 12), months: months % 12 } : current.basics.experience;

  let next = 100;
  const links = [
    { name: "LinkedIn", url: basics.linkedin },
    { name: "Website", url: basics.website },
  ].filter((link) => /^https?:\/\//.test(link.url.trim()) && !current.onlineProfiles.some((kept) => sameUrl(kept.url, link.url)));
  const onlineProfiles: SectionItem<"onlineProfiles">[] = [...current.onlineProfiles, ...links.map((link) => ({ id: `new-${++next}`, name: link.name, url: link.url.trim(), description: "" }))];
  const languages: SectionItem<"languages">[] = [
    ...current.languages,
    ...profile.languages
      .filter((language) => language.name.trim() && !current.languages.some((kept) => sameText(kept.language, language.name)))
      .map((language) => ({ id: `new-${++next}`, language: language.name.trim(), languageRef: null, proficiency: PROFICIENCY[language.level] ?? 2, read: true, write: true, speak: true })),
  ];

  const city = basics.city.trim() && !sameText(basics.city, current.basics.city?.name ?? "") ? basics.city.trim() : null;
  return {
    city,
    values: {
      ...current,
      basics: { ...current.basics, name: current.basics.name || basics.name.trim(), experience },
      personal: {
        ...current.personal,
        birthDate: /^\d{4}-\d{2}-\d{2}$/.test(basics.dob) ? basics.dob : current.personal.birthDate,
        address: basics.address.trim() || current.personal.address,
      },
      onlineProfiles,
      languages,
    },
  };
}
