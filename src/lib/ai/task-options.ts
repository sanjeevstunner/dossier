import "server-only";

import { maxPages } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import type { TaskOptions } from "./tasks";

/** The AI behaviour saved in Settings (SET-3, SET-4, SET-7, SET-9), for running a task. */
export async function loadTaskOptions(): Promise<Omit<TaskOptions, "signal">> {
  const s = await loadSettings();
  // A custom prompt reaches the AI only with the master switch and its own on; off gives "".
  const pick = (on: boolean, text: string) => (s.customPrompts && on ? text.trim() : "");
  // Null follows the posting's language.
  return {
    creativity: s.creativity,
    strict: s.strict,
    language: s.docLanguage,
    maxPages: maxPages(s.pageLimit),
    prompts: {
      global: pick(s.promptGlobalOn, s.promptGlobal),
      docs: pick(s.promptDocsOn, s.promptDocs),
      resume: pick(s.promptResumeOn, s.promptResume),
      agent: pick(s.promptAgentOn, s.promptAgent),
    },
  };
}
