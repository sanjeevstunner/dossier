import { describe, expect, it } from "vitest";

import { hasUserPrompts, userPrompts } from "./prompt-parts";

const prompts = { global: "G", docs: "D", resume: "", agent: "A" };

describe("userPrompts", () => {
  it("joins the non-empty prompts of the given scopes", () => {
    const text = userPrompts({ prompts }, "global", "docs", "resume");
    expect(text).toContain("G\n\nD");
    expect(text).not.toContain("A");
  });
  it("is empty when nothing is on or no prompts are given", () => {
    expect(userPrompts({ prompts }, "resume", false)).toBe("");
    expect(userPrompts({}, "global")).toBe("");
  });
});

describe("hasUserPrompts", () => {
  it("is true only when a given scope has text", () => {
    expect(hasUserPrompts({ prompts }, "global")).toBe(true);
    expect(hasUserPrompts({ prompts }, "resume", false)).toBe(false);
    expect(hasUserPrompts({}, "global")).toBe(false);
  });
});
