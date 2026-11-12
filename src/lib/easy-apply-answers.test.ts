import { describe, expect, it } from "vitest";

import type { NaukriQuestion } from "@/lib/job-search/naukri";

import { checkAnswers, reviewQuestions } from "./easy-apply-answers";

const question = (extra: Partial<NaukriQuestion>): NaukriQuestion => ({ id: "q", text: "Q", type: "text", options: {}, required: true, skippable: false, prefill: [], ...extra });

describe("checkAnswers", () => {
  it("wants required questions answered, and lets optional ones go", () => {
    expect(checkAnswers([question({})], {})).toMatch(/needs an answer/);
    expect(checkAnswers([question({ required: false })], {})).toBeNull();
  });

  it("holds text to the limit, the question's own when it has one", () => {
    expect(checkAnswers([question({})], { q: "x".repeat(100) })).toBeNull();
    expect(checkAnswers([question({})], { q: "x".repeat(101) })).toMatch(/too long/);
    expect(checkAnswers([question({ maxLength: 10 })], { q: "x".repeat(11) })).toMatch(/too long/);
  });

  it("takes only the options of a choice, and one of them", () => {
    const choice = question({ type: "choice", options: { a: "Yes", b: "No" } });
    expect(checkAnswers([choice], { q: ["Yes"] })).toBeNull();
    expect(checkAnswers([choice], { q: ["Maybe"] })).toMatch(/isn't one of its options/);
    expect(checkAnswers([choice], { q: ["Yes", "No"] })).toMatch(/takes one answer/);
    expect(checkAnswers([question({ type: "multi", options: { a: "A", b: "B" } })], { q: ["A", "B"] })).toBeNull();
  });
});

describe("reviewQuestions", () => {
  it("shows labels, the limit and the suggestion, empty when there's none", () => {
    const [text, choice] = reviewQuestions([question({}), question({ id: "c", type: "choice", options: { a: "Yes" } })], { c: ["Yes"] });
    expect(text).toMatchObject({ maxLength: 100, suggested: "" });
    expect(choice).toMatchObject({ options: ["Yes"], suggested: ["Yes"] });
  });
});
