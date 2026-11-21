import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import { editableSchema } from "@/lib/naukri-profile";

import { MockProvider } from "../providers/mock";

import { cleanDraft, mergeDraft, TAILOR_NAUKRI_PROFILE_VERSION, tailorNaukriProfile, type NaukriProfileDraft } from "./tailor-naukri-profile";

const current = editableSchema.parse({
  headline: "Fullstack Engineer",
  summary: "Builds web apps.",
  keySkills: ["React", "Node.js"],
  desiredRoles: [{ id: 16881, name: "Fullstack Software Developer" }],
  employments: [
    { id: "e1", current: true, designation: { id: "5555", name: "SE 2" }, company: { id: "47", name: "7EDGE" }, start: "2025-11", end: null, description: "Old", skills: ["React"], experienceType: "F" },
  ],
  itSkills: [{ id: "s1", skill: { id: "56097", name: "React.js" }, version: "19", lastUsed: 2026, experience: { years: 3, months: 5 } }],
  personal: { birthDate: "2000-09-14", gender: "M", address: "Secret street", hometown: "", pincode: "", maritalStatus: null },
});
const reasons = { headline: "h", summary: "s", keySkills: "k", desiredRoles: "r", employments: "e", itSkills: "i", projects: "p", educations: "ed", certifications: "c", publications: "pu", workSamples: "w" };
const draft = (extra: Partial<NaukriProfileDraft> = {}): NaukriProfileDraft => ({
  headline: "AI Engineer",
  summary: "S",
  keySkills: ["Python"],
  desiredRoles: ["AI Engineer"],
  employments: [],
  itSkills: [],
  projects: [],
  educations: [],
  certifications: [],
  publications: [],
  workSamples: [],
  reasons,
  ...extra,
});
const options = { creativity: "BALANCED" as const, strict: true, language: null };

describe("cleanDraft", () => {
  it("holds Naukri's limits and keeps each skill and role once", () => {
    const cleaned = cleanDraft(
      draft({
        headline: `AI Engineer — ${"x".repeat(300)}`,
        summary: "y".repeat(1200),
        keySkills: ["Node.js", " node.js ", "AWS, Lambda", "", ...Array.from({ length: 60 }, (_, i) => `S${i}`)],
        desiredRoles: ["AI Engineer", "AI Engineer", "FDE", "Backend Developer", "Data Engineer"],
      }),
    );
    expect(cleaned.headline).toHaveLength(250);
    expect(cleaned.headline.startsWith("AI Engineer - ")).toBe(true);
    expect(cleaned.summary).toHaveLength(1000);
    expect(cleaned.keySkills.slice(0, 3)).toEqual(["Node.js", "AWS Lambda", "S0"]);
    expect(cleaned.keySkills).toHaveLength(50);
    expect(cleaned.desiredRoles).toEqual(["AI Engineer", "FDE", "Backend Developer"]);
  });
});

describe("mergeDraft", () => {
  it("rewrites only the words of items on Naukri, keeps their facts, and never removes one", () => {
    const merged = mergeDraft(
      current,
      draft({
        employments: [{ id: "e1", designation: "CTO", company: "Google", current: false, start: "2001-01", end: "2002-01", description: "New words", skills: ["AWS"] }],
        itSkills: [],
      }),
    );
    expect(merged.employments).toEqual([{ ...current.employments[0], description: "New words", skills: ["AWS"] }]);
    expect(merged.itSkills).toEqual(current.itSkills);
    expect(merged.headline).toBe("AI Engineer");
  });

  it("adds new items under temporary ids with names to look up, and drops ones missing what Naukri needs", () => {
    const merged = mergeDraft(
      current,
      draft({
        itSkills: [{ id: "", skill: "Python", version: "3.12", lastUsed: 2026, years: 2.4, months: 14 }],
        projects: [
          { id: "", title: "Dossier", client: "", role: "Author", start: "2025-01", end: "", skills: "Next.js", details: "Job search app" },
          { id: "", title: "No date", client: "", role: "", start: "soon", end: "", skills: "", details: "" },
        ],
        workSamples: [{ id: "", title: "Demo", url: "not a link", description: "", start: "", end: "" }],
      }),
    );
    expect(merged.itSkills[1]).toEqual({ id: "new-1", skill: { id: null, name: "Python" }, version: "3.12", lastUsed: 2026, experience: { years: 2, months: 11 } });
    expect(merged.projects).toEqual([{ id: "new-2", title: "Dossier", client: "Self", role: "Author", start: "2025-01", end: null, skills: "Next.js", details: "Job search app" }]);
    expect(merged.workSamples).toEqual([]);
  });
});

describe("tailorNaukriProfile", () => {
  it("asks with the target and the Naukri profile, never the personal details", async () => {
    const provider = new MockProvider({ reply: () => draft() });
    const { data, promptVersion } = await tailorNaukriProfile(provider, { role: "Forward Deployed Engineer", notes: "Lead with AWS", current, profile: demoProfile() }, options);
    expect(promptVersion).toBe(TAILOR_NAUKRI_PROFILE_VERSION);
    expect(data.headline).toBe("AI Engineer");
    const sent = JSON.stringify(provider.calls[0]);
    expect(sent).toContain("Target role: Forward Deployed Engineer");
    expect(sent).toContain("Lead with AWS");
    expect(sent).toContain("Fullstack Software Developer");
    expect(sent).toContain("React.js");
    expect(sent).not.toContain("Secret street");
    expect(sent).not.toContain("2000-09-14");
  });
});
