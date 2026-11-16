import { describe, expect, it } from "vitest";

import { differs, salaryText, updateOf, updateSchema, type NaukriEditable } from "./naukri-profile";

const now: NaukriEditable = {
  headline: "Fullstack Engineer",
  summary: "S",
  keySkills: ["React", "Node.js"],
  desiredRoles: [{ id: 1, name: "Developer" }],
  preferredLocations: [{ id: 97, name: "Bangalore/Bengaluru" }],
  expectedSalary: { amount: 1500000, currency: "INR" },
  noticePeriodId: 1,
};

describe("differs", () => {
  it("ignores case and surrounding spaces, not order or content", () => {
    expect(differs("headline", now, { ...now, headline: " Fullstack Engineer " })).toBe(false);
    expect(differs("keySkills", now, { ...now, keySkills: ["react", "node.js"] })).toBe(false);
    expect(differs("keySkills", now, { ...now, keySkills: ["Node.js", "React"] })).toBe(true);
    expect(differs("preferredLocations", now, { ...now, preferredLocations: [{ id: 97, name: "bangalore/bengaluru" }] })).toBe(false);
    expect(differs("expectedSalary", now, { ...now, expectedSalary: { amount: 1800000, currency: "INR" } })).toBe(true);
  });
});

describe("updateOf", () => {
  it("sends only the accepted fields, trimmed, and nothing that's unset", () => {
    const values = { ...now, headline: " AI Engineer ", noticePeriodId: null };
    expect(updateOf(values, ["headline", "noticePeriodId"])).toEqual({ headline: "AI Engineer" });
    expect(updateSchema.safeParse(updateOf(values, ["headline", "keySkills"])).success).toBe(true);
    expect(updateSchema.safeParse({}).success).toBe(false);
    expect(updateSchema.safeParse({ noticePeriodId: 9 }).success).toBe(false);
  });
});

it("writes salaries in Indian grouping", () => {
  expect(salaryText({ amount: 1800000, currency: "INR" })).toBe("₹18,00,000 a year");
  expect(salaryText(null)).toBe("Not set");
});
