import { describe, expect, it } from "vitest";

import { afterUpdate, differs, editableSchema, fitKeySkills, itemProblem, salaryText, SECTIONS, updateOf, updateSchema, type NaukriEditable } from "./naukri-profile";

const employment = { id: "e1", current: true, designation: { id: "5555", name: "SE 2" }, company: { id: "47", name: "7EDGE" }, start: "2025-11", end: null, description: "Full stack", skills: ["React"], experienceType: "F" as const };
const now: NaukriEditable = editableSchema.parse({
  headline: "Fullstack Engineer",
  summary: "S",
  keySkills: ["React", "Node.js"],
  desiredRoles: [{ id: 1, name: "Developer" }],
  preferredLocations: [{ id: 97, name: "Bangalore/Bengaluru" }],
  expectedSalary: { amount: 1500000, currency: "INR" },
  noticePeriodId: 1,
  employments: [employment],
  onlineProfiles: [{ id: "o1", name: "LinkedIn", url: "https://linkedin.com/in/x", description: "" }],
});

describe("editableSchema", () => {
  it("reads a partial answer with every section empty rather than failing", () => {
    const empty = editableSchema.parse({ headline: "H", employments: "nope" });
    expect(empty.employments).toEqual([]);
    expect(empty.basics).toEqual({ name: "", city: null, experience: { years: 0, months: 0 }, currentSalary: null });
  });
});

describe("differs", () => {
  it("ignores case and surrounding spaces, not order or content", () => {
    expect(differs("headline", now, { ...now, headline: " Fullstack Engineer " })).toBe(false);
    expect(differs("keySkills", now, { ...now, keySkills: ["react", "node.js"] })).toBe(false);
    expect(differs("keySkills", now, { ...now, keySkills: ["Node.js", "React"] })).toBe(true);
    expect(differs("preferredLocations", now, { ...now, preferredLocations: [{ id: 97, name: "bangalore/bengaluru" }] })).toBe(false);
  });
});

describe("updateOf", () => {
  it("sends only the accepted fields and items, adds without their temporary ids, and the deletes", () => {
    const values: NaukriEditable = {
      ...now,
      headline: " AI Engineer ",
      noticePeriodId: null,
      employments: [{ ...employment, description: "New words" }],
      itSkills: [{ id: "new-1", skill: { id: "1", name: "Go" }, version: "", lastUsed: null, experience: { years: 1, months: 0 } }],
    };
    const update = updateOf(values, new Set(["headline", "noticePeriodId", "employments:e1", "itSkills:new-1"]), new Set(["onlineProfiles:o1"]));
    expect(update).toEqual({
      headline: "AI Engineer",
      sections: { employments: [{ ...employment, description: "New words" }], itSkills: [{ ...values.itSkills[0], id: undefined }] },
      remove: [{ section: "onlineProfiles", id: "o1" }],
    });
    expect(updateSchema.safeParse(update).success).toBe(true);
    expect(updateSchema.safeParse({}).success).toBe(false);
    expect(updateSchema.safeParse({ noticePeriodId: 9 }).success).toBe(false);
    expect(updateSchema.safeParse({ personal: { maritalStatus: "N" } }).success).toBe(true);
    const noCity = updateOf({ ...now, basics: { name: "S", city: null, experience: { years: 3, months: 6 }, currentSalary: null } }, new Set(["basics"]));
    expect(noCity).toEqual({ basics: { name: "S", experience: { years: 3, months: 6 } } });
    expect(updateSchema.safeParse(noCity).success).toBe(true);
    expect(updateSchema.safeParse({ personal: { maritalStatus: { id: 1, name: "Single/unmarried" } } }).success).toBe(false);
  });
});

describe("afterUpdate", () => {
  it("takes what was sent as Naukri saved it and keeps every suggestion not sent yet", () => {
    const values: NaukriEditable = {
      ...now,
      headline: "AI Engineer",
      summary: "Pending summary",
      employments: [{ ...employment, description: "Pending words" }],
      itSkills: [{ id: "new-1", skill: { id: null, name: "Go" }, version: "", lastUsed: null, experience: { years: 1, months: 0 } }],
    };
    const saved: NaukriEditable = { ...now, headline: "AI Engineer", onlineProfiles: [] };
    const next = afterUpdate(values, saved, new Set(["headline"]), new Set(["onlineProfiles:o1"]));
    expect(next.headline).toBe("AI Engineer");
    expect(next.summary).toBe("Pending summary");
    expect(next.employments[0]!.description).toBe("Pending words");
    expect(next.itSkills.map((item) => item.id)).toEqual(["new-1"]);
    expect(next.onlineProfiles).toEqual([]);
    // A sent new item comes back with Naukri's id and isn't kept twice.
    const added = afterUpdate(values, { ...saved, itSkills: [{ ...values.itSkills[0]!, id: "i9" }] }, new Set(["itSkills:new-1"]), new Set());
    expect(added.itSkills.map((item) => item.id)).toEqual(["i9"]);
  });
});

describe("itemProblem", () => {
  it("names what Naukri needs before an item can be sent", () => {
    const fields = SECTIONS.employments.fields;
    expect(itemProblem(fields, employment)).toBeNull();
    expect(itemProblem(fields, { ...employment, company: { id: null, name: " " } })).toBe("Company is needed.");
    expect(itemProblem(fields, { ...employment, start: "Nov 2025" })).toBe("Started (YYYY-MM): use YYYY-MM.");
    expect(itemProblem(fields, { ...employment, current: false, end: null })).toBe("Ended is needed for a past job.");
    expect(itemProblem(SECTIONS.onlineProfiles.fields, { name: "GitHub", url: "github.com/x", description: "" })).toBe("URL: use a full address starting with https://.");
  });
});

it("writes salaries in Indian grouping", () => {
  expect(salaryText({ amount: 1800000, currency: "INR" })).toBe("₹18,00,000 a year");
  expect(salaryText(null)).toBe("Not set");
});

describe("key skills length", () => {
  const skills = Array.from({ length: 30 }, (_, i) => `skill number ${i}`);
  it("keeps only what fits Naukri's 250 characters, in order", () => {
    const kept = fitKeySkills(skills);
    expect(kept.join(",").length).toBeLessThanOrEqual(250);
    expect(kept).toEqual(skills.slice(0, kept.length));
    expect(kept.length).toBeLessThan(skills.length);
  });
  it("refuses an update over 250 characters", () => {
    expect(updateSchema.safeParse({ keySkills: skills }).success).toBe(false);
    expect(updateSchema.safeParse({ keySkills: fitKeySkills(skills) }).success).toBe(true);
  });
});
