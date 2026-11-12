import { z } from "zod";

import { NAUKRI_TEXT_MAX, type NaukriAnswers, type NaukriQuestion } from "@/lib/job-search/naukri";

/** A question as the review form shows it: choices by their labels, which is what Naukri takes. */
export type ReviewQuestion = {
  id: string;
  text: string;
  type: NaukriQuestion["type"];
  /** The labels to choose from; empty for a text question. */
  options: string[];
  required: boolean;
  /** The longest text answer Naukri takes. */
  maxLength: number;
  /** What the agent would answer: text, or the chosen labels; empty when the profile doesn't say. */
  suggested: string | string[];
};

/** The review form's questions, with the agent's answers as the suggestions. */
export function reviewQuestions(questions: NaukriQuestion[], suggested: NaukriAnswers): ReviewQuestion[] {
  return questions.map((question) => ({
    id: question.id,
    text: question.text,
    type: question.type,
    options: Object.values(question.options),
    required: question.required,
    maxLength: question.maxLength ?? NAUKRI_TEXT_MAX,
    suggested: suggested[question.id] ?? (question.type === "text" ? "" : []),
  }));
}

/**
 * Checks answers the user gave against the questions, before anything is
 * sent: text within Naukri's limit, choices among the options, required
 * questions answered. Gives what's wrong in words for the user, or null.
 */
export function checkAnswers(questions: NaukriQuestion[], answers: NaukriAnswers): string | null {
  for (const question of questions) {
    const given = answers[question.id];
    const list = given === undefined ? [] : Array.isArray(given) ? given : [given];
    const filled = list.map((value) => value.trim()).filter(Boolean);
    const label = question.text || `Question ${question.id}`;
    if (filled.length === 0) {
      if (question.required) return `“${label}” needs an answer.`;
      continue;
    }
    if (question.type === "text") {
      if (typeof given !== "string") return `“${label}” takes a text answer.`;
      if (given.length > (question.maxLength ?? NAUKRI_TEXT_MAX)) return `The answer to “${label}” is too long.`;
    } else {
      const labels = Object.values(question.options);
      if (!filled.every((value) => labels.includes(value))) return `“${label}” has an answer that isn't one of its options.`;
      if (question.type === "choice" && filled.length > 1) return `“${label}” takes one answer.`;
    }
  }
  return null;
}

/** Reviewed answers as they come from the form: by question id, text or the chosen labels. Each is checked against its question before sending (checkAnswers). */
export const reviewedAnswersSchema = z.record(z.string().min(1).max(100), z.union([z.string().max(1000), z.array(z.string().max(500)).max(50)]));
