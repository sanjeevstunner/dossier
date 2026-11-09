import { describe, expect, it } from "vitest";

import { groupSkills, parseSkillsText, skillNamesIn, skillsText } from "@/lib/profile";

import { groupsFrom } from "./group-skills";

describe("groupsFrom", () => {
  it("keeps only the profile's skills, once, and puts the rest under Other", () => {
    const groups = groupsFrom(["React", "Figma", "Go"], {
      groups: [
        { name: "Frontend", skills: ["react", "Vue", "React"] },
        { name: "Design", skills: ["Figma"] },
      ],
    });
    expect([...groups]).toEqual([["React", "Frontend"], ["Figma", "Design"], ["Go", "Other"]]);
  });
});

describe("skills text", () => {
  const skills = [{ name: "React", group: "Frontend" }, { name: "Go", group: "" }, { name: "Vue", group: "Frontend" }];

  it("groups with Other last, or stays flat", () => {
    expect(groupSkills(skills)?.map((group) => group.name)).toEqual(["Frontend", "Other"]);
    expect(skillsText(skills)).toBe("Frontend: React · Vue\nOther: Go");
    expect(skillsText(skills, false)).toBe("React · Go · Vue");
    expect(skillsText([{ name: "Go" }])).toBe("Go");
  });

  it("reads both forms back", () => {
    expect(parseSkillsText("Frontend: React · Vue\nOther: Go")).toEqual([{ group: "Frontend", skills: "React · Vue" }, { group: "Other", skills: "Go" }]);
    expect(skillNamesIn("Frontend: React · Vue\nOther: Go")).toEqual(["React", "Vue", "Go"]);
    expect(skillNamesIn("React · Vue")).toEqual(["React", "Vue"]);
  });
});
