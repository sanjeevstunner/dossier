import { expect, test } from "@playwright/test";

import { resetData } from "./support";

// A new application from a pasted posting (E7), with the fake AI server.
test.beforeAll(resetData);

const POSTING = `Ledgerly: Senior Product Designer, Payments
Amsterdam (hybrid, 3 days in office) · €75,000–€90,000

What we're looking for
- 5+ years of product design
- You've built or maintained a design system
- Strong prototyping skills in Figma
- Experience with Kubernetes
- Dutch is a plus`;

test("reads a posting, shows the match and writes tailored documents", async ({ page }) => {
  await page.goto("/new?fresh=1");
  await page.getByLabel("Job posting").fill(POSTING);
  await page.getByRole("button", { name: "Read the posting →" }).click();

  await expect(page.getByRole("heading", { name: "How you match" })).toBeVisible();
  await expect(page.getByLabel("Company")).toHaveValue("Ledgerly");
  await expect(page.getByLabel("Role")).toHaveValue("Senior Product Designer, Payments");
  await expect(page.getByText("Experience with Kubernetes")).toBeVisible();

  await page.getByLabel("Anything I should know?").fill("I'm moving to Amsterdam in January.");
  await page.getByRole("button", { name: "Create application →" }).click();
  await page.waitForURL(/\/applications\/c/, { timeout: 30_000 });

  await expect(page.getByRole("heading", { level: 1, name: "Senior Product Designer, Payments · Ledgerly" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Resume" })).toContainText("Jane Doe");
  await page.getByRole("tab", { name: "Cover letter" }).click();
  await expect(page.getByText("Payments are where trust is won or lost")).toBeVisible();
  // What you told the AI is the application's first fact (APP-15).
  await page.getByRole("tab", { name: /Job posting/ }).click();
  await expect(page.getByRole("region", { name: "Facts for this application" }).getByRole("textbox", { name: "Fact 1", exact: true })).toHaveValue("I'm moving to Amsterdam in January.");
});

test("won't fetch a posting from the server's own network (E7-8)", async ({ page }) => {
  await page.goto("/new?fresh=1");
  await page.getByLabel(/^Link to the posting/).fill("http://localhost:3100/login");
  await page.getByRole("button", { name: "Fetch" }).click();
  await expect(page.getByText("Dossier doesn't fetch addresses on your own network. Paste the posting instead.")).toBeVisible();
  await expect(page.getByLabel("Job posting")).toHaveValue("");
});


test("adds an application sent elsewhere by hand, then has the AI catch up", async ({ page }) => {
  await page.goto("/new?fresh=1");
  await page.getByLabel("Job posting").fill(POSTING);
  await page.getByRole("button", { name: "Continue without reading" }).click();
  await page.getByLabel("Company").fill("Ledgerly");
  await page.getByLabel("Role").fill("Product Designer");
  await page.getByRole("button", { name: "Add documents manually →" }).click();

  await page.locator('input[type="file"]').first().setInputFiles({
    name: "Jane Doe Resume.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF"),
  });
  await expect(page.getByText("Jane Doe Resume.pdf")).toBeVisible();
  await page.getByLabel("To").fill("jobs@ledgerly.com");
  await page.getByLabel("Subject").fill("Product Designer application");
  await page.getByLabel("Status").selectOption("SENT");
  await page.getByLabel("Applied on").fill("2026-10-01");
  await page.getByRole("button", { name: "Add application" }).click();
  await page.waitForURL(/\/applications\/c/, { timeout: 30_000 });

  await expect(page.getByRole("heading", { level: 1, name: "Product Designer · Ledgerly" })).toBeVisible();
  await expect(page.getByTitle("Your resume")).toBeVisible();
  await page.getByRole("tab", { name: "Email" }).click();
  await expect(page.getByText("jobs@ledgerly.com")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download Jane Doe Resume.pdf" })).toHaveAttribute("href", /\/files\/resume\?download$/);

  await page.getByRole("tab", { name: /Job posting/ }).click();
  await page.getByRole("button", { name: "Generate “How you match”" }).click();
  await expect(page.getByText(/covered by your profile/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: "Cover letter" }).click();
  await page.getByRole("button", { name: "Generate with AI" }).click();
  await expect(page.getByText("Payments are where trust is won or lost")).toBeVisible({ timeout: 30_000 });
});
