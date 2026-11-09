// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateSettings } from "./actions";
import { ProfileSection } from "./profile-section";

vi.mock("./actions", () => ({ updateSettings: vi.fn(async () => ({ ok: true, data: null })) }));

beforeEach(() => vi.mocked(updateSettings).mockClear());

describe("Settings → Profile", () => {
  it("groups the lists under Experience and Projects", () => {
    render(<ProfileSection initial={{ projectKinds: [], jobTypes: [] }} />);
    expect(screen.getByRole("heading", { name: "Experience" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();
  });

  it("adds and removes job types", async () => {
    const user = userEvent.setup();
    render(<ProfileSection initial={{ projectKinds: [], jobTypes: ["Full-time", "Remote"] }} />);
    await user.type(screen.getByLabelText("New job type"), "Freelance{Enter}");
    expect(updateSettings).toHaveBeenLastCalledWith({ jobTypes: ["Full-time", "Remote", "Freelance"] });
    await user.type(screen.getByLabelText("New job type"), "remote{Enter}");
    expect(updateSettings).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Remove Remote" }));
    expect(updateSettings).toHaveBeenLastCalledWith({ jobTypes: ["Full-time", "Freelance"] });
  });
});
