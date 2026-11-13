import { describe, expect, it, vi } from "vitest";

import type { Unit } from "@/lib/application-data";
import { demoProfile } from "@/lib/demo-profile";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { nextCut } = await import("./page-limit");

describe("nextCut with the candidate's own resume prompt", () => {
  const profile = demoProfile();
  const units: Unit[] = [
    ...profile.experience.map((role) => ({ id: `experience:${role.id}`, label: role.company, text: "One\nTwo" })),
    ...profile.projects.map((project) => ({ id: `project:${project.id}`, label: project.name, text: "Built it" })),
  ];

  it("cuts the oldest role first by default", () => {
    const cut = nextCut(units, profile)?.trimmed;
    expect(cut?.kind === "unit" && cut.unit.id.startsWith("experience:")).toBe(true);
  });

  it("cuts only projects, never roles or their bullets, when experience is kept", () => {
    const cut = nextCut(units, profile, true)?.trimmed;
    expect(cut?.kind === "unit" && cut.unit.id.startsWith("project:")).toBe(true);
    const withoutProjects = units.filter((unit) => unit.id.startsWith("experience:"));
    expect(nextCut(withoutProjects, profile, true)).toBeNull();
  });
});
