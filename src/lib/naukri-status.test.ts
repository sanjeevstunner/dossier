import { describe, expect, it } from "vitest";

import { DEFAULT_NAUKRI_STATUS_MAP, duplicateNaukriWord, statusFromNaukri } from "./naukri-status";

describe("Naukri status words", () => {
  const map = DEFAULT_NAUKRI_STATUS_MAP;

  it("match a listed word ignoring case and spaces", () => {
    expect(statusFromNaukri("  applied ", map)).toBe("SENT");
    expect(statusFromNaukri("RECRUITER VIEWED", map)).toBe("SCREENING");
  });

  it("ignore case, punctuation, accents and repeated spaces", () => {
    expect(statusFromNaukri("Not-Shortlisted", map)).toBe("REJECTED");
    expect(statusFromNaukri("not   shortlisted ", map)).toBe("REJECTED");
    expect(statusFromNaukri("recruiter_viewed", map)).toBe("SCREENING");
    expect(statusFromNaukri("Applied.", map)).toBe("SENT");
    expect(statusFromNaukri("Reviewed", map)).toBeNull();
    expect(duplicateNaukriWord({ ...map, OFFER: ["APPLIED!"] })).toBe("APPLIED!");
  });

  it("prefer the longest listed word a status contains", () => {
    expect(statusFromNaukri("Not Shortlisted", map)).toBe("REJECTED");
    expect(statusFromNaukri("Shortlisted for round 1", map)).toBe("SCREENING");
    expect(statusFromNaukri("Interview scheduled", map)).toBe("INTERVIEW");
  });

  it("are null when nothing is listed for them", () => {
    expect(statusFromNaukri("Profile Boosted", map)).toBeNull();
    expect(statusFromNaukri(undefined, map)).toBeNull();
    expect(statusFromNaukri("", map)).toBeNull();
  });

  it("follow a changed list", () => {
    const changed = { ...map, SCREENING: ["Under Review"], OFFER: ["Selected"] };
    expect(statusFromNaukri("Under review", changed)).toBe("SCREENING");
    expect(statusFromNaukri("Selected", changed)).toBe("OFFER");
    expect(statusFromNaukri("Viewed", changed)).toBeNull();
  });

  it("find a word listed under two statuses", () => {
    expect(duplicateNaukriWord(map)).toBeNull();
    expect(duplicateNaukriWord({ ...map, OFFER: ["applied"] })).toBe("applied");
  });
});
