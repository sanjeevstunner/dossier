import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { resolveAllNaukriConflicts, resolveNaukriConflict } from "../actions";
import { ReviewScreen, type ReviewItem } from "./review-screen";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("../actions", () => ({
  resolveNaukriConflict: vi.fn(async () => ({ ok: true, data: null })),
  resolveAllNaukriConflicts: vi.fn(async () => ({ ok: true, data: 2 })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const item = (id: string, extra: Partial<ReviewItem> = {}): ReviewItem => ({
  id,
  company: "Acme",
  title: "Backend Engineer",
  status: "INTERVIEW",
  statusSince: "2026-11-20T10:00:00.000Z",
  word: "Applied",
  naukriStatus: "SENT",
  ...extra,
});

describe("the Naukri review screen", () => {
  it("shows your status beside Naukri's own word", () => {
    render(<ReviewScreen items={[item("a")]} />);
    expect(screen.getByText("Interview")).toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.getByText("“Applied”")).toBeInTheDocument();
  });

  it("settles one application either way", async () => {
    render(<ReviewScreen items={[item("a")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(resolveNaukriConflict).toHaveBeenCalledWith({ id: "a", choice: "dossier" });
    await userEvent.click(screen.getByRole("button", { name: "Use Naukri" }));
    expect(resolveNaukriConflict).toHaveBeenCalledWith({ id: "a", choice: "naukri" });
  });

  it("settles everything at once from two applications up", async () => {
    render(<ReviewScreen items={[item("a"), item("b")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Use Naukri for all" }));
    expect(resolveAllNaukriConflicts).toHaveBeenCalledWith({ choice: "naukri" });
  });

  it("says when there is nothing to review", () => {
    render(<ReviewScreen items={[]} />);
    expect(screen.getByText("Nothing to review.")).toBeInTheDocument();
  });
});
