import { z } from "zod";

// Naukri's status words and the Dossier status each stands for. The words are
// the user's to edit in Settings, so a renamed word on Naukri is one line to fix.

/** The statuses an application can reach once it's sent; the ones a Naukri word can mean. */
export const NAUKRI_MAPPED_STATUSES = ["SENT", "SCREENING", "INTERVIEW", "OFFER", "ACCEPTED", "REJECTED", "DECLINED"] as const;
export type NaukriMappedStatus = (typeof NAUKRI_MAPPED_STATUSES)[number];

/** Each status with the Naukri words that mean it. */
export type NaukriStatusMap = Record<NaukriMappedStatus, string[]>;

export const DEFAULT_NAUKRI_STATUS_MAP: NaukriStatusMap = {
  SENT: ["Applied"],
  SCREENING: ["Viewed", "Recruiter Viewed", "Shortlisted", "Under Consideration"],
  INTERVIEW: ["Interview"],
  OFFER: ["Offer"],
  ACCEPTED: [],
  REJECTED: ["Not Shortlisted", "Rejected", "Not Selected"],
  DECLINED: [],
};

const words = z.array(z.string().trim().min(1).max(60)).max(30);
export const naukriStatusMapSchema = z.object({
  SENT: words,
  SCREENING: words,
  INTERVIEW: words,
  OFFER: words,
  ACCEPTED: words,
  REJECTED: words,
  DECLINED: words,
});

/** A word as it's compared: lower case, accents and punctuation gone, runs of spaces made one ("Not-Shortlisted", "not  shortlisted" → "not shortlisted"). */
export const normalizeNaukriWord = (word: string): string =>
  word
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The first word listed under two statuses (any case), or null: matching must not be ambiguous. */
export function duplicateNaukriWord(map: NaukriStatusMap): string | null {
  const seen = new Set<string>();
  for (const status of NAUKRI_MAPPED_STATUSES) {
    for (const word of map[status]) {
      const key = normalizeNaukriWord(word);
      if (seen.has(key)) return word;
      seen.add(key);
    }
  }
  return null;
}

/**
 * Dossier's status for a Naukri status word: a listed word that matches it
 * exactly, else the longest listed word it contains ("Not Shortlisted" beats
 * "Shortlisted"), else null.
 */
export function statusFromNaukri(word: string | undefined, map: NaukriStatusMap): NaukriMappedStatus | null {
  const text = normalizeNaukriWord(word ?? "");
  if (!text) return null;
  let best: { status: NaukriMappedStatus; length: number } | null = null;
  for (const status of NAUKRI_MAPPED_STATUSES) {
    for (const listed of map[status]) {
      const key = normalizeNaukriWord(listed);
      if (!key) continue;
      if (key === text) return status;
      if ((` ${text} `).includes(` ${key} `) && (!best || key.length > best.length)) best = { status, length: key.length };
    }
  }
  return best?.status ?? null;
}
