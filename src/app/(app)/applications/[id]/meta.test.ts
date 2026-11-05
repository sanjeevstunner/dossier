import { describe, expect, it } from "vitest";

import { metaLine, sourceLine } from "./meta";

const application = {
  location: "Amsterdam",
  mode: "Hybrid · 3 days in office",
  salary: "€75–90k",
  deadline: new Date("2026-10-15T00:00:00Z"),
  createdAt: new Date(2026, 8, 27, 10),
};

describe("metaLine (APP-1)", () => {
  it("lists location, work mode, salary, deadline and creation date", () => {
    expect(metaLine(application)).toEqual([
      "Amsterdam",
      "Hybrid · 3 days in office",
      "€75–90k",
      "Apply by 15 Oct 2026",
      "Created 27 Sep 2026",
    ]);
  });

  it("leaves out what isn't known", () => {
    expect(metaLine({ ...application, location: " ", salary: "", deadline: null })).toEqual([
      "Hybrid · 3 days in office",
      "Created 27 Sep 2026",
    ]);
  });
});

describe("sourceLine", () => {
  const none = { posting: null, agentCandidate: null, startup: null };
  it("names the screen and the job board", () => {
    expect(sourceLine(none)).toBe("Added by you");
    expect(sourceLine({ ...none, posting: { source: "NAUKRI", via: "" } })).toBe("From Find jobs on Naukri");
    expect(sourceLine({ ...none, posting: { source: "JSEARCH", via: "LinkedIn" } })).toBe("From Find jobs on LinkedIn via JSearch");
    expect(sourceLine({ ...none, agentCandidate: { source: "NAUKRI", via: "Naukri", agent: { name: "Job agent 2" } } })).toBe("From Job agent 2 on Naukri");
    expect(sourceLine({ ...none, agentCandidate: { source: "ADZUNA", via: "", agent: null } })).toBe("From the job agent on Adzuna");
    expect(sourceLine({ ...none, startup: { source: "YC" } })).toBe("From Startups on YC");
  });
});
