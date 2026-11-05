import { expect, test, type Page } from "@playwright/test";

import { fakeJobSearches, resetData, sql } from "./support";

// The job agents end to end (E16): one made and set up on the Agents screen,
// run now against the fake JSearch and the fake AI, a draft prepared and
// approved, a posting dismissed, a second run past the hourly wait that
// brings none of them back, and a second agent that doesn't either.
test.beforeAll(resetData);
// Gone again, so their timer leaves the other specs alone.
test.afterAll(async () => {
  await sql(`DELETE FROM "Agent"`);
  await sql(`DELETE FROM "AgentCandidate"`);
});

const card = (page: Page, title: string) => page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: title }) });

/** A new agent searching for product designers in the Netherlands, turned on. */
async function newAgent(page: Page) {
  await page.goto("/agent");
  await page.getByRole("button", { name: "New agent" }).click();
  await expect(page).toHaveURL(/\/agent\/[^/]+$/);
  await page.getByLabel("What").fill("Product designer");
  await page.getByLabel("Country").selectOption("nl");
  await page.getByRole("switch", { name: "Active" }).click();
  await expect(page.getByRole("switch", { name: "Active" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/^Next run: /)).toBeVisible();
  return page.url();
}

test("finds, scores, drafts and dismisses, and never brings a posting back", async ({ page }) => {
  const agentUrl = await newAgent(page);

  // Run now: one search, three postings scored, two in the queue, all in the run's log.
  const searches = await fakeJobSearches();
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText("2 new postings are waiting for a look.").first()).toBeVisible({ timeout: 30_000 });
  expect(await fakeJobSearches()).toBe(searches + 1);
  await expect(page.getByRole("list", { name: "Log" })).toContainText("Searching for new postings");
  await expect(page.getByRole("list", { name: "Log" })).toContainText("Scored 91: Senior Product Designer, Payments");

  const waiting = async () => {
    await page.getByRole("tab", { name: /^Waiting/ }).click();
    return page.getByRole("region", { name: "Scored postings" });
  };
  const scored = await waiting();
  await expect(scored.getByRole("heading", { level: 3 })).toHaveText(["Senior Product Designer, Payments", "Product Designer, Logistics"]);
  await expect(card(page, "Senior Product Designer, Payments").getByRole("img", { name: "Score 91 of 100" })).toBeVisible();
  // The one below the minimum score waits behind Show.
  await expect(page.getByRole("heading", { level: 3, name: "UX Designer" })).toHaveCount(0);
  await page.getByRole("button", { name: "1 below your minimum score of 70 · Show" }).click();
  await expect(page.getByRole("heading", { level: 3, name: "UX Designer" })).toBeVisible();

  // Prepare a draft: it waits for review, out of Applications.
  await card(page, "Senior Product Designer, Payments").getByRole("button", { name: "Prepare draft" }).click();
  const drafts = page.getByRole("region", { name: "Drafts to review" });
  await expect(drafts.getByRole("heading", { level: 3, name: "Senior Product Designer, Payments" })).toBeVisible({ timeout: 60_000 });
  const [draft] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE origin = 'AGENT'`);
  await expect(drafts.getByRole("link", { name: "Review draft" })).toHaveAttribute("href", `/applications/${draft.id}`);
  await page.goto("/applications?view=table");
  await expect(page.locator(`a[href="/applications/${draft.id}"]`)).toHaveCount(0);
  await page.goto(`/applications/${draft.id}`);
  await expect(page.getByRole("link", { name: "From the job agent · waiting for review" })).toHaveAttribute("href", new URL(agentUrl).pathname);

  // Approve it: a normal Draft application now, still unsent.
  await page.goto(agentUrl);
  await waiting();
  await drafts.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Added to Applications as a draft. Nothing has been sent.")).toBeVisible();
  await page.goto("/applications?view=table");
  await expect(page.locator(`a[href="/applications/${draft.id}"]`).first()).toBeVisible();
  expect(await sql(`SELECT status, "awaitingReview" FROM "Application" WHERE id = $1`, [draft.id])).toEqual([{ status: "DRAFT", awaitingReview: false }]);

  // Dismiss the other one.
  await page.goto(agentUrl);
  await waiting();
  await card(page, "Product Designer, Logistics").getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("Dismissed. It won't come back.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Product Designer, Logistics" })).toHaveCount(0);

  // Run now again within the hour warns; Run anyway goes ahead and brings none of them back.
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText(/^This agent ran less than an hour ago\. Its wait is over in \d+ minutes\.$/)).toBeVisible();
  await page.getByRole("button", { name: "Run anyway" }).click();
  await expect(page.getByText("No new postings this time.").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("list", { name: "Runs" }).getByRole("listitem")).toHaveCount(2);

  // A second agent with the same search finds nothing new either: what one saw, all have.
  await newAgent(page);
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText("No new postings this time.").first()).toBeVisible({ timeout: 30_000 });

  // Both on the Agents screen.
  await page.getByRole("link", { name: "Agents", exact: true }).first().click();
  await expect(page).toHaveURL("/agent");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Job agent", "Job agent 2"]);
});
