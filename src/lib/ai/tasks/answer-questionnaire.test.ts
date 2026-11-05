import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";

import type { NaukriQuestion } from "@/lib/job-search/naukri";

import { MockProvider } from "../providers/mock";

import { ANSWER_QUESTIONNAIRE_VERSION, answerQuestionnaire, answersFrom } from "./answer-questionnaire";

const q = (id: string, text: string, type: NaukriQuestion["type"], options: Record<string, string> = {}, required = true): NaukriQuestion => ({
  id,
  text,
  type,
  options,
  required,
  skippable: false,
  prefill: [],
});
const questions = [
  q("1", "Are you willing to relocate to Chennai?", "choice", { 0: "Yes", 1: "No" }),
  q("2", "Which AI coding tools have you used?", "text"),
  q("3", "Have you worked with LLMs?", "choice", { newOption1: "Yes", newOption2: "No" }),
  q("4", "Tools you know", "multi", { a: "Figma", b: "Sketch", c: "Excel" }, false),
];
const options = { creativity: "FAITHFUL" as const, strict: true, language: null };
const found = (id: string, answer: string) => ({ id, answer, found: true, missing: "" });

describe("answersFrom", () => {
  it("sends choices as their labels, as Naukri's page does, and caps text at 100 characters", () => {
    expect(answersFrom(questions, [found("1", "0"), found("2", ` ${"x".repeat(150)} `), found("3", "newOption1"), found("4", "a, c")])).toEqual({
      answers: { "1": ["Yes"], "2": "x".repeat(100), "3": ["Yes"], "4": ["Figma", "Excel"] },
      missing: [],
    });
  });

  it("counts a required question as missing when not found, a label instead of a key, or no answer; leaves optional ones out", () => {
    expect(
      answersFrom(questions, [
        { id: "1", answer: "", found: false, missing: "Whether you'd relocate to Chennai" },
        found("2", "Cursor"),
        found("3", "Yes"),
        found("4", "z"),
      ]),
    ).toEqual({ answers: { "2": "Cursor" }, missing: ["Whether you'd relocate to Chennai", "Have you worked with LLMs?"] });
  });
});

describe("answerQuestionnaire", () => {
  it("sends the questions as data and checks the answers", async () => {
    const provider = new MockProvider({ reply: () => ({ answers: [found("1", "1"), found("2", "Cursor, Claude Code"), found("3", "newOption2")] }) });
    const { data, promptVersion } = await answerQuestionnaire(provider, { questions, profile: demoProfile(), title: "AI Engineer", company: "Acme" }, options);
    expect(promptVersion).toBe(ANSWER_QUESTIONNAIRE_VERSION);
    expect(data).toEqual({ answers: { "1": ["No"], "2": "Cursor, Claude Code", "3": ["No"] }, missing: [] });
    expect(JSON.stringify(provider.calls[0])).toContain("Have you worked with LLMs?");
  });
});
