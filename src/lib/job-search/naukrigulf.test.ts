import { afterEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";

import { clearJobSearchCache } from "./cache";
import { JobSearchError } from "./errors";
import { naukriGulf, naukriGulfApply, naukriGulfAuth, naukriGulfHasApplied, naukriGulfRecommended } from "./naukrigulf";
import { EMPTY_QUERY } from "./search";

const credentials = { url: "http://noperi.local:3000/", apiKey: "k".repeat(24) };
const query = { ...EMPTY_QUERY, keywords: "devops", place: "Dubai", country: "ae", experience: 5 };
const job = {
  jobId: "41126502315",
  title: "DevOps <b>Engineer</b>",
  company: "Acme Gulf",
  location: "Dubai - United Arab Emirates",
  experience: "3-6 Yrs",
  salary: "",
  postedDate: "2026-11-10T08:00:00.000Z",
  applyLink: "https://www.naukrigulf.com/devops-engineer-jobs-in-dubai-uae-41126502315",
  description: "<p>Run the cloud</p>",
  tags: ["AWS"],
};

afterEach(() => {
  vi.unstubAllGlobals();
  clearJobSearchCache();
});

describe("NaukriGulf search", () => {
  it("asks NopeRi's /api/gulf with the API key, the experience and NaukriGulf's own filters", async () => {
    const requests = stubFetch(() => json({ jobs: [job], total: 1, clusters: {} }));
    const page = await naukriGulf.search({ ...query, filters: { country: ["17"], ctc: ["2.5"], wfhType: ["2"] } }, credentials, "page:2");
    const [{ url, headers }] = requests;
    expect(`${url.origin}${url.pathname}`).toBe("http://noperi.local:3000/api/gulf/jobs/search");
    expect(url.searchParams.get("keyword")).toBe("devops");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("location")).toBe("Dubai");
    expect(url.searchParams.get("experience")).toBe("5");
    expect(url.searchParams.getAll("filter.country")).toEqual(["17"]);
    expect(url.searchParams.getAll("filter.ctc")).toEqual(["2.5"]);
    // Naukri's groups aren't NaukriGulf's.
    expect(url.searchParams.has("filter.wfhType")).toBe(false);
    expect(headers.get("x-api-key")).toBe(credentials.apiKey);
    expect(page.next).toBeNull();
    expect(page.filters).toBeUndefined();
    expect(page.postings[0]).toMatchObject({
      source: "NAUKRIGULF",
      externalId: "41126502315",
      title: "DevOps Engineer",
      company: "Acme Gulf",
      postedAt: "2026-11-10T08:00:00.000Z",
      description: "Run the cloud",
      complete: false,
    });
  });

  it("reads NaukriGulf's filter groups from the first page, in Dossier's order, and pages on", async () => {
    const clusters = {
      citysrp: [{ id: "201", count: 90, label: "Dubai" }],
      country: [{ id: "17", count: 270, label: "UAE" }],
      titles: [{ id: "1", count: 1, label: "Unknown group" }],
    };
    const many = Array.from({ length: 20 }, (_, index) => ({ ...job, jobId: String(index + 1) }));
    stubFetch(() => json({ jobs: many, total: 270, clusters }));
    const page = await naukriGulf.search({ ...query, remoteOnly: true }, credentials, null);
    expect(page.next).toBe("page:2");
    expect(page.filters).toEqual({ total: 270, groups: [{ key: "country", options: clusters.country }, { key: "citysrp", options: clusters.citysrp }] });
  });

  it("leaves out unreadable and repeated jobs, and dates it can't read", async () => {
    stubFetch(() => json({ jobs: [job, { ...job }, { title: "No id" }, { ...job, jobId: "2", postedDate: "" }], total: 4 }));
    const page = await naukriGulf.search(query, credentials, null);
    expect(page.postings.map((posting) => posting.externalId)).toEqual(["41126502315", "2"]);
    expect(page.postings[1].postedAt).toBeNull();
  });

  it("says when NopeRi answers something else", async () => {
    stubFetch(() => json([job]));
    await expect(naukriGulf.search(query, credentials, null)).rejects.toMatchObject({ problem: "changed" });
  });
});

describe("NaukriGulf sign-in", () => {
  it("tells a missing NaukriGulf sign-in from a wrong API key", async () => {
    stubFetch(({ url }) => (url.pathname === "/api/gulf/auth/status" ? json({ loggedIn: false, loginTime: null }) : json({ error: {} }, { status: 401 })));
    await expect(naukriGulf.details({ externalId: "1" } as never, credentials)).rejects.toMatchObject({ problem: "login", message: "Log in to NaukriGulf first." });
    stubFetch(() => json({ error: {} }, { status: 401 }));
    const error = await naukriGulfAuth(credentials, "login").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JobSearchError);
    expect((error as JobSearchError).problem).toBe("key");
  });

  it("signs in with NopeRi's credentials or a browser's AT token", async () => {
    const requests = stubFetch(() => json({ loggedIn: true, loginTime: "2026-11-13T09:00:00.000Z" }));
    expect(await naukriGulfAuth(credentials, "status")).toEqual({ loggedIn: true, loginTime: "2026-11-13T09:00:00.000Z" });
    await naukriGulfAuth(credentials, "login");
    await naukriGulfAuth(credentials, { token: "t".repeat(30) });
    expect(requests.map(({ url }) => url.pathname)).toEqual(["/api/gulf/auth/status", "/api/gulf/auth/login", "/api/gulf/auth/token"]);
    expect(requests[2].body).toEqual({ token: "t".repeat(30) });
    expect(await naukriGulf.test(credentials)).toBeUndefined();
  });
});

describe("NaukriGulf recommendations", () => {
  it("maps NopeRi's recommended jobs and keeps them for half an hour", async () => {
    const requests = stubFetch(() => json([job, { ...job, jobId: "7" }]));
    const postings = await naukriGulfRecommended(credentials);
    expect(postings.map((posting) => [posting.source, posting.externalId])).toEqual([
      ["NAUKRIGULF", "41126502315"],
      ["NAUKRIGULF", "7"],
    ]);
    expect(await naukriGulfRecommended(credentials)).toEqual(postings);
    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe("/api/gulf/jobs/recommended");
  });
});

describe("NaukriGulf details", () => {
  it("reads the posting's text from whichever field NaukriGulf gave", async () => {
    const posting = { externalId: "41126502315" } as never;
    const requests = stubFetch(() => json({ Job: { Description: "<p>All of it</p>" } }));
    expect(await naukriGulf.details(posting, credentials)).toBe("All of it");
    expect(requests[0].url.pathname).toBe("/api/gulf/jobs/41126502315");
    stubFetch(() => json({ Job: { jobInfo: "Only the start" } }));
    expect(await naukriGulf.details(posting, credentials)).toBe("Only the start");
    stubFetch(() => json({ Job: {} }));
    expect(await naukriGulf.details(posting, credentials)).toBeNull();
    stubFetch(() => json({ nothing: true }));
    expect(await naukriGulf.details(posting, credentials)).toBeNull();
  });
});

describe("NaukriGulf easy apply", () => {
  it("posts the apply and reads what NaukriGulf said", async () => {
    const requests = stubFetch(() => json({ applied: true, status: 200, result: { status: 200 } }));
    expect(await naukriGulfApply(credentials, "41126502315")).toEqual({
      applied: true,
      alreadyApplied: false,
      companySite: false,
      needsMore: false,
      status: 200,
      message: null,
    });
    expect(requests[0].url.pathname).toBe("/api/gulf/jobs/41126502315/apply");
    expect(requests[0].body).toEqual({ source: "self" });

    stubFetch(() => json({ applied: true, alreadyApplied: true }));
    expect(await naukriGulfApply(credentials, "1")).toMatchObject({ applied: true, alreadyApplied: true });

    stubFetch(() => json({ applied: false, status: 200, result: { status: 307 } }));
    expect(await naukriGulfApply(credentials, "1")).toMatchObject({ applied: false, companySite: true, needsMore: false });

    stubFetch(() => json({ applied: false, status: 400, layerCode: "QUP", message: "Answer the questions", result: {} }));
    expect(await naukriGulfApply(credentials, "1")).toMatchObject({ applied: false, companySite: false, needsMore: true, message: "Answer the questions" });

    stubFetch(() => json({ ok: true }));
    await expect(naukriGulfApply(credentials, "1")).rejects.toMatchObject({ problem: "changed" });
  });

  it("finds an apply in NaukriGulf's history, leading zeros aside", async () => {
    const requests = stubFetch(() => json({ totalEasyApplies: 2, jobs: [{ jobId: "041126502315" }, { jobId: 99 }] }));
    expect(await naukriGulfHasApplied(credentials, "41126502315")).toBe(true);
    expect(await naukriGulfHasApplied(credentials, "99")).toBe(true);
    expect(await naukriGulfHasApplied(credentials, "5")).toBe(false);
    expect(`${requests[0].url.pathname}${requests[0].url.search}`).toBe("/api/gulf/applications?type=easy&limit=50");
  });
});
