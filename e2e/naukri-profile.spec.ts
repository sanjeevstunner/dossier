import { expect, test } from "@playwright/test";

import { fakeNaukriUpdates, resetData } from "./support";

// Naukri profile against the fake NopeRi (e2e/fake-jobs.mts) and the fake AI:
// suggestions next to what Naukri shows, accepting one, editing another, and
// an update that sends only those two.
test.beforeAll(resetData);

test("tailors the Naukri profile and sends only the accepted changes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/naukri-profile");
  await expect(page.getByRole("heading", { name: "Naukri profile" })).toBeVisible();

  await page.getByLabel("Role you're after").fill("Product Designer");
  await page.getByLabel("Preferred locations").fill("Bengaluru, Pune");
  await page.getByRole("button", { name: "Suggest changes" }).click();

  const changes = page.getByRole("region", { name: "Suggested changes" });
  await expect(changes.getByRole("heading", { name: /suggested changes/ })).toBeVisible({ timeout: 30_000 });
  await expect(changes).toContainText("Now on Naukri");
  await expect(changes).toContainText("Product designer"); // the current headline
  await expect(changes.getByLabel("Suggested headline")).toHaveValue("Product Designer with design systems and accessibility experience");

  // Nothing accepted yet: nothing to send.
  await expect(changes.getByRole("button", { name: "Update Naukri profile" })).toHaveAttribute("aria-disabled", "true");

  // Accept the headline as it is; editing the key skills accepts them too.
  await changes.getByRole("group", { name: "Resume headline" }).getByLabel("Accept").check();
  await changes.getByLabel("Add a key skill").fill("Prototyping");
  await changes.getByLabel("Add a key skill").press("Enter");

  await changes.getByRole("button", { name: "Update Naukri profile (2)" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Update Naukri profile" }).click();
  await expect(page.getByText("Naukri profile updated.")).toBeVisible();

  const [update] = (await fakeNaukriUpdates()).slice(-1);
  expect(update).toEqual({
    headline: "Product Designer with design systems and accessibility experience",
    keySkills: ["Figma", "Design systems", "Accessibility", "Prototyping"],
  });
  await expect(page.getByRole("region", { name: "Suggested changes" })).toHaveCount(0);
});
