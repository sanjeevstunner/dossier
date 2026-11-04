import { afterEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";

import { JobSearchError } from "./errors";
import { naukri, naukriAuth, postedAtFromLabel } from "./naukri";
import { EMPTY_QUERY } from "./search";

const credentials = { url: "http://noperi.local:3000/", apiKey: "k".repeat(24) };
const query = { ...EMPTY_QUERY, keywords: "node.js", place: "Bengaluru", country: "in", postedWithin: "week" as const, experience: 4 };
const job = {
  jobId: "123",
  title: "Backend <b>Engineer</b>",
  company: "Acme",
  location: "Bengaluru",
  experience: "3-6 Yrs",
  salary: "Not disclosed",
  postedDate: "3 Days Ago",
  applyLink: "https://www.naukri.com/job-listings-123",
  description: "<p>Build APIs</p>",
  tags: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("Naukri search", () => {
  it("asks NopeRi with the API key and every filter", async () => {
    const requests = stubFetch(() => json([job]));
    const page = await naukri.search(query, credentials, "page:2");
    const [{ url, headers }] = requests;
    expect(`${url.origin}${url.pathname}`).toBe("http://noperi.local:3000/api/jobs/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({ keyword: "node.js", page: "2", resultsPerPage: "20", location: "Bengaluru", jobAge: "7", experience: "4" });
    expect(headers.get("x-api-key")).toBe(credentials.apiKey);
    expect(page.next).toBeNull();
    expect(page.postings[0]).toMatchObject({ source: "NAUKRI", externalId: "123", title: "Backend Engineer", salary: "", description: "Build APIs", complete: false });
  });

  it("tells a missing Naukri sign-in from a wrong API key", async () => {
    stubFetch(({ url }) => (url.pathname === "/api/auth/status" ? json({ loggedIn: false, loginTime: null }) : json({ error: {} }, { status: 401 })));
    await expect(naukri.details({ ...job, externalId: "123" } as never, credentials)).rejects.toMatchObject({ problem: "login" });
    stubFetch(() => json({ error: {} }, { status: 401 }));
    const error = await naukriAuth(credentials, "login").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JobSearchError);
    expect((error as JobSearchError).problem).toBe("key");
  });
});

describe("postedAtFromLabel", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  it("reads Naukri's labels", () => {
    expect(postedAtFromLabel("Just Now", now)).toBe(now.toISOString());
    expect(postedAtFromLabel("3 Days Ago", now)).toBe("2026-11-01T12:00:00.000Z");
    expect(postedAtFromLabel("30+ Days Ago", now)).toBe("2026-10-05T12:00:00.000Z");
    expect(postedAtFromLabel("N/A", now)).toBeNull();
  });
});
