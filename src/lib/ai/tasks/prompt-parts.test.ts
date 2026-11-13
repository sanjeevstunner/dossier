import { describe, expect, it } from "vitest";

import { userPrompts } from "./prompt-parts";

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
