import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import type { NaukriEditable } from "@/lib/naukri-profile";

import { MockProvider } from "../providers/mock";

import { cleanDraft, TAILOR_NAUKRI_PROFILE_VERSION, tailorNaukriProfile } from "./tailor-naukri-profile";

const current: NaukriEditable = {
  headline: "Fullstack Engineer",
  summary: "Builds web apps.",
  keySkills: ["React", "Node.js"],
  desiredRoles: [{ id: 16881, name: "Fullstack Software Developer" }],
  preferredLocations: [{ id: 97, name: "Bangalore/Bengaluru" }],
  expectedSalary: { amount: 1500000, currency: "INR" },
  noticePeriodId: 1,
};
const reasons = { headline: "h", summary: "s", keySkills: "k", desiredRoles: "r" };
const options = { creativity: "BALANCED" as const, strict: true, language: null };

describe("cleanDraft", () => {
  it("holds Naukri's limits and keeps each skill and role once", () => {
    const draft = cleanDraft({
      headline: `AI Engineer — ${"x".repeat(300)}`,
      summary: "y".repeat(1200),
      keySkills: ["Node.js", " node.js ", "AWS, Lambda", "", ...Array.from({ length: 60 }, (_, i) => `S${i}`)],
      desiredRoles: ["AI Engineer", "AI Engineer", "FDE", "Backend Developer", "Data Engineer"],
      reasons,
    });
    expect(draft.headline).toHaveLength(250);
    expect(draft.headline.startsWith("AI Engineer - ")).toBe(true);
    expect(draft.summary).toHaveLength(1000);
    expect(draft.keySkills.slice(0, 3)).toEqual(["Node.js", "AWS Lambda", "S0"]);
    expect(draft.keySkills).toHaveLength(50);
    expect(draft.desiredRoles).toEqual(["AI Engineer", "FDE", "Backend Developer"]);
  });
});

describe("tailorNaukriProfile", () => {
  it("asks with the target, the current Naukri profile and the candidate's profile", async () => {
    const provider = new MockProvider({ reply: () => ({ headline: "AI Engineer", summary: "S", keySkills: ["Python"], desiredRoles: ["AI Engineer"], reasons }) });
    const { data, promptVersion } = await tailorNaukriProfile(provider, { role: "Forward Deployed Engineer", notes: "Lead with AWS", current, profile: demoProfile() }, options);
    expect(promptVersion).toBe(TAILOR_NAUKRI_PROFILE_VERSION);
    expect(data).toEqual({ headline: "AI Engineer", summary: "S", keySkills: ["Python"], desiredRoles: ["AI Engineer"], reasons });
    const sent = JSON.stringify(provider.calls[0]);
    expect(sent).toContain("Target role: Forward Deployed Engineer");
    expect(sent).toContain("Lead with AWS");
    expect(sent).toContain("Fullstack Software Developer");
  });
});
