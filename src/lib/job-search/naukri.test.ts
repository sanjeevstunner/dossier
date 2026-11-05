import { afterEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";

const fetchPosting = vi.hoisted(() => vi.fn(async () => ({ ok: false, error: "unreachable" })));
vi.mock("@/lib/posting-fetch", () => ({ fetchPosting }));

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

  it("sends chosen filters and reads Naukri's filter groups from the first page", async () => {
    const answer = {
      jobs: [job],
      total: 1563,
      clusters: {
        citiesGid: [{ id: "97", count: 111, label: "Bengaluru" }],
        wfhType: [{ id: "2", count: 50, label: "Remote" }, { id: "3", count: 17, label: "Hybrid" }],
        employement: [{ id: "1", count: 1516, label: "Company Jobs" }],
      },
      clusterOrder: ["wfhType", "experience", "citiesGid", "employement"],
    };
    const requests = stubFetch(() => json(answer));
    const page = await naukri.search({ ...query, filters: { wfhType: ["2", "3"] } }, credentials, null);
    expect(requests[0].url.searchParams.getAll("filter.wfhType")).toEqual(["2", "3"]);
    expect(page.postings).toHaveLength(1);
    // Groups Dossier doesn't know (employement) are left out; Naukri's order is kept.
    expect(page.filters).toEqual({ total: 1563, groups: [{ key: "wfhType", options: answer.clusters.wfhType }, { key: "citiesGid", options: answer.clusters.citiesGid }] });
    expect((await naukri.search(query, credentials, "page:2")).filters).toBeUndefined();
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

describe("Naukri details", () => {
  it("gives the company-site apply link for external-apply jobs, and only the text for easy apply", async () => {
    const posting = { externalId: "123" } as never;
    stubFetch(() => json({ externalApply: true, details: { jobDetails: { description: "<p>All</p>", applyRedirectUrl: "https://acme.example/apply" } } }));
    expect(await naukri.details(posting, credentials)).toEqual({ text: "All", applyUrl: "https://acme.example/apply" });
    fetchPosting.mockResolvedValueOnce({ ok: true, text: "Company says more." } as never);
    expect(await naukri.details(posting, credentials)).toEqual({ text: "All\n\nFrom the company site:\nCompany says more.", applyUrl: "https://acme.example/apply" });
    expect(fetchPosting).toHaveBeenLastCalledWith("https://acme.example/apply");
    stubFetch(() => json({ externalApply: false, details: { jobDetails: { description: "<p>All</p>" } } }));
    expect(await naukri.details(posting, credentials)).toBe("All");
    stubFetch(() => json({ externalApply: true, details: { jobDetails: { description: "x", applyRedirectUrl: "javascript:alert(1)" } } }));
    expect(await naukri.details(posting, credentials)).toBe("x");
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
