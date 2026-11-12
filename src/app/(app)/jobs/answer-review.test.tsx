import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ReviewQuestion } from "@/lib/easy-apply-answers";

import { AnswerReview } from "./answer-review";

const questions: ReviewQuestion[] = [
  { id: "t", text: "Years of Python", type: "text", options: [], required: true, maxLength: 100, suggested: "" },
  { id: "c", text: "Willing to relocate?", type: "choice", options: ["Yes", "No"], required: true, maxLength: 100, suggested: ["No"] },
  { id: "m", text: "Tools you use", type: "multi", options: ["Git", "Docker"], required: false, maxLength: 100, suggested: [] },
];

const open = (extra = {}) => {
  const onSend = vi.fn(async () => {});
  const onKeep = vi.fn(async () => {});
  render(<AnswerReview applicationId="app-1" review={{ questions, resume: "uploaded" }} onSend={onSend} onKeep={onKeep} {...extra} />);
  return { onSend, onKeep, user: userEvent.setup() };
};

describe("AnswerReview", () => {
  it("shows a choice as radio buttons, several choices as checkboxes, and text held to its limit", () => {
    open();
    expect(screen.getByRole("radio", { name: "No" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Yes" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Docker" })).toBeInTheDocument();
    const text = screen.getByRole("textbox", { name: "Years of Python" });
    expect(text).toHaveAttribute("maxLength", "100");
    expect(screen.getByText("0/100")).toBeInTheDocument();
  });

  it("holds Send and Add to draft until the required questions are answered", async () => {
    const { onSend, onKeep, user } = open();
    await user.click(screen.getByRole("button", { name: "Send with Naukri agent" }));
    await user.click(screen.getByRole("button", { name: "Add to draft" }));
    expect(onSend).not.toHaveBeenCalled();
    expect(onKeep).not.toHaveBeenCalled();
  });

  it("sends the answers as edited, leaving out optional ones left blank", async () => {
    const { onSend, user } = open();
    await user.type(screen.getByRole("textbox", { name: "Years of Python" }), " 5 ");
    await user.click(screen.getByRole("radio", { name: "Yes" }));
    await user.click(screen.getByRole("button", { name: "Send with Naukri agent" }));
    expect(onSend).toHaveBeenCalledWith({ t: "5", c: ["Yes"] });
  });

  it("adds the answers to the draft without sending", async () => {
    const { onSend, onKeep, user } = open();
    await user.type(screen.getByRole("textbox", { name: "Years of Python" }), "3");
    await user.click(screen.getByRole("checkbox", { name: "Git" }));
    await user.click(screen.getByRole("button", { name: "Add to draft" }));
    expect(onKeep).toHaveBeenCalledWith({ t: "3", c: ["No"], m: ["Git"] });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("confirms just the resume when there are no questions, and says questions come next", async () => {
    const { onSend, user } = open({ review: { questions: [], resume: "uploaded" } });
    expect(screen.getByText(/Check the resume that will be sent/)).toBeInTheDocument();
    expect(screen.getByText(/Resume that will be sent/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send with Naukri agent" }));
    expect(onSend).toHaveBeenCalledWith({});
  });

  it("leaves the resume out when only the answers are confirmed", () => {
    open({ review: { questions, resume: null } });
    expect(screen.queryByText(/Resume that will be sent/)).not.toBeInTheDocument();
  });
});
