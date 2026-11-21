import { expect, test } from "@playwright/test";

import { fakeNaukriUpdates, resetData } from "./support";

// Naukri profile against the fake NopeRi (e2e/fake-jobs.mts) and the fake AI:
// a fine-tuned suggestion for one section, then the whole profile; sending one
// change keeps the others; then accepting, editing and deleting more.
test.beforeAll(resetData);

test("tailors the Naukri profile and sends only the accepted changes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/naukri-profile");
  await expect(page.getByRole("heading", { name: "Naukri profile" })).toBeVisible();
  // Every section is there to edit before any suggestion.
  await expect(page.getByRole("group", { name: "Employment" })).toContainText("UI Designer at Ledgerly");
  await expect(page.getByRole("group", { name: "Online profiles" })).toContainText("Dribbble");

  const target = page.getByRole("form", { name: "Target role" });
  await target.getByLabel("Role you're after").fill("Product Designer");

  // One section, fine-tuned: only the headline changes.
  await page.getByRole("button", { name: "Fine-tune Resume headline" }).click();
  const tune = page.getByRole("form", { name: "Fine-tune Resume headline" });
  await tune.getByLabel("How should the AI change this?").fill("Lead with the role");
  await tune.getByRole("button", { name: "Suggest" }).click();
  const headline = page.getByRole("group", { name: "Resume headline" });
  await expect(headline.getByLabel("Suggested headline")).toHaveValue("Product Designer with design systems and accessibility experience", { timeout: 30_000 });
  await expect(headline).toContainText("Product designer"); // what Naukri has now
  const job = page.getByRole("group", { name: "Employment" }).getByRole("group", { name: /UI Designer at Ledgerly/ });
  await expect(job).not.toContainText("(changed)");

  // Then the whole profile; nothing accepted yet: nothing to send.
  await target.getByRole("button", { name: "Suggest whole profile" }).click();
  await expect(job).toContainText("(changed)", { timeout: 30_000 });
  const changes = page.getByRole("region", { name: "Changes" });
  await expect(changes.getByRole("button", { name: "Update Naukri profile" })).toHaveAttribute("aria-disabled", "true");

  // Send only the headline: the job's suggestion stays for later.
  await headline.getByLabel("Accept").check();
  await changes.getByRole("button", { name: "Update Naukri profile (1)" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Update Naukri profile" }).click();
  await expect(page.getByText("Naukri profile updated.")).toBeVisible();
  expect((await fakeNaukriUpdates()).slice(-1)[0]).toEqual({ headline: "Product Designer with design systems and accessibility experience" });
  await expect(job).toContainText("(changed)");
  await expect(job.getByLabel("Job profile")).toHaveValue("Led Ledgerly's design system across 4 products.");

  // Accept the rewritten job profile; editing the key skills accepts them too; and delete an online profile.
  await job.getByLabel("Accept").check();
  const skills = page.getByRole("group", { name: "Key skills" });
  await skills.getByLabel("Add a key skill").fill("Prototyping");
  await skills.getByLabel("Add a key skill").press("Enter");
  await page.getByRole("group", { name: /Dribbble/ }).getByRole("button", { name: "Delete" }).click();

  await changes.getByRole("button", { name: "Update Naukri profile (3)" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Update Naukri profile" }).click();
  await expect(page.getByText("Naukri profile updated.").last()).toBeVisible();

  const [update] = (await fakeNaukriUpdates()).slice(-1);
  expect(update).toEqual({
    keySkills: ["Figma", "Design systems", "Accessibility", "Prototyping"],
    sections: {
      employments: [
        {
          id: "e2e-emp",
          current: true,
          designation: { id: "2001", name: "UI Designer" },
          company: { id: "9", name: "Ledgerly" },
          start: "2021-03",
          end: null,
          description: "Led Ledgerly's design system across 4 products.",
          skills: ["Figma", "Design systems"],
          experienceType: "F",
        },
      ],
    },
    remove: [{ section: "onlineProfiles", id: "e2e-dribbble" }],
  });
});
