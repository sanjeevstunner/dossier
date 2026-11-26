import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateSettings } from "./actions";
import { NaukriApplySection } from "./naukri-apply-section";

vi.mock("./actions", () => ({ updateSettings: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean }) => result }));

const initial = {
  easyApplyAnswerQuestions: true,
  easyApplyTailorResume: true,
  easyApplySwapResume: true,
  easyApplyAutoSubmit: true,
  confirmApplyAnswers: false,
  confirmApplyResume: false,
};

beforeEach(() => vi.mocked(updateSettings).mockClear());

describe("Naukri easy apply agent settings", () => {
  it("saves each step on its own", async () => {
    const user = userEvent.setup();
    render(<NaukriApplySection initial={initial} />);
    await user.click(screen.getByRole("switch", { name: "Answer questions with AI" }));
    expect(updateSettings).toHaveBeenLastCalledWith({ easyApplyAnswerQuestions: false });
    await user.click(screen.getByRole("switch", { name: "Submit the application" }));
    expect(updateSettings).toHaveBeenLastCalledWith({ easyApplyAutoSubmit: false });
    await user.click(screen.getByRole("switch", { name: "Send the tailored resume with the apply" }));
    expect(updateSettings).toHaveBeenLastCalledWith({ easyApplySwapResume: false });
  });

  it("hides the swap under tailoring, and the confirmations under their steps", async () => {
    const user = userEvent.setup();
    render(<NaukriApplySection initial={{ ...initial, confirmApplyAnswers: true }} />);
    expect(screen.getByRole("switch", { name: "Also confirm the resume" })).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Tailor the resume" }));
    expect(updateSettings).toHaveBeenLastCalledWith({ easyApplyTailorResume: false });
    expect(screen.queryByRole("switch", { name: "Send the tailored resume with the apply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Also confirm the resume" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Answer questions with AI" }));
    expect(screen.queryByRole("switch", { name: "Confirm easy apply answers" })).not.toBeInTheDocument();
  });
});
