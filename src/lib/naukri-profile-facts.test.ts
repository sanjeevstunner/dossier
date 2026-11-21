import { describe, expect, it } from "vitest";

import { demoProfile } from "./demo-profile";
import { editableSchema } from "./naukri-profile";
import { withProfileFacts } from "./naukri-profile-facts";

describe("withProfileFacts", () => {
  it("fills experience, personal details, missing links and languages from the profile", () => {
    const profile = demoProfile();
    profile.basics = { ...profile.basics, city: "Pune", dob: "1990-02-03", address: "1 Main Rd", linkedin: "https://www.linkedin.com/in/x/", website: "https://x.dev" };
    profile.languages = [{ id: "l1", name: "English", level: "C2" }, { id: "l2", name: "Hindi", level: "B1" }];
    profile.experience = [{ ...profile.experience[0], startYear: 2020, startMonth: 1, endYear: 2021, endMonth: 6, current: false }];
    const current = editableSchema.parse({
      basics: { name: "Sanjeev", city: { id: 17, name: "Hyderabad" }, experience: { years: 3, months: 6 }, currentSalary: null },
      onlineProfiles: [{ id: "o1", name: "LinkedIn", url: "https://linkedin.com/in/x", description: "" }],
      languages: [{ id: "g1", language: "english", languageRef: "1", proficiency: 3, read: true, write: true, speak: true }],
    });
    const { values, city } = withProfileFacts(current, profile, new Date(2026, 10, 16));
    expect(city).toBe("Pune");
    expect(values.basics).toMatchObject({ name: "Sanjeev", experience: { years: 1, months: 6 } });
    expect(values.personal).toMatchObject({ birthDate: "1990-02-03", address: "1 Main Rd" });
    expect(values.onlineProfiles.map((item) => item.url)).toEqual(["https://linkedin.com/in/x", "https://x.dev"]);
    expect(values.languages.map((item) => [item.language, item.proficiency])).toEqual([["english", 3], ["Hindi", 2]]);
    expect(values.languages[1].id).toMatch(/^new-/);
  });
});
