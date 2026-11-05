import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { AgentDetailView } from "@/lib/agent/view";
import { COUNTRIES } from "@/lib/job-search/countries";

import { deleteAgent, runAgentNow, saveAgent } from "../actions";
import { AgentDetailScreen } from "./agent-detail-screen";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/agent/a1" }));
vi.mock("@/hooks/use-job", () => ({ useJob: () => null }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean }) => result }));
vi.mock("../actions", () => ({
  runAgentNow: vi.fn(async () => ({ ok: true, data: { jobId: "run-1", warning: null } })),
  saveAgent: vi.fn(async () => ({ ok: true, data: null })),
  deleteAgent: vi.fn(async () => ({ ok: true, data: null })),
  createAgent: vi.fn(async () => ({ ok: true, data: { id: "a3" } })),
  prepareAgentDraft: vi.fn(),
  approveAgentDraft: vi.fn(),
  dismissAgentCandidate: vi.fn(),
  restoreAgentCandidate: vi.fn(),
}));

const query = { keywords: "Product designer", place: "Rotterdam", country: "nl", radiusKm: 25, remoteOnly: false, postedWithin: "any" } as const;
const view: AgentDetailView = {
  id: "a1",
  config: { name: "Designers", enabled: true, query, source: null, hour: 7, days: [1, 2, 3, 4, 5], minScore: 70, maxScores: 15, maxDrafts: 3, autoDraft: false, maxRunsPerDay: 3, manualIntervalMinutes: 60 },
  agents: [
    { id: "a1", name: "Designers", enabled: true },
    { id: "a2", name: "Data", enabled: false },
  ],
  search: "Product designer · Rotterdam, 25 km · via JSearch",
  schedule: "Weekdays at 07:00",
  setupProblem: null,
  setupSection: null,
  limitWarning: null,
  nextRun: "Wed 21 Oct, 07:00",
  runJobId: null,
  runs: [
    { id: "r2", at: "Tue 20 Oct, 07:00", manual: false, status: "DONE", message: "2 new postings are waiting for a look." },
    { id: "r1", at: "Mon 19 Oct, 09:12", manual: true, status: "FAILED", message: "The run didn't finish." },
  ],
  run: {
    id: "r2",
    at: "Tue 20 Oct, 07:00",
    finishedAt: "Tue 20 Oct, 07:01",
    manual: false,
    status: "DONE",
    message: "2 new postings are waiting for a look.",
    counts: { found: 10, fresh: 3, scored: 3, drafted: 0, skipped: 7 },
    steps: [
      { at: "Tue 20 Oct, 07:00", text: "Searching for new postings" },
      { at: "Tue 20 Oct, 07:01", text: "Scored 90: Senior Designer at Ledgerly" },
    ],
    postings: [{ id: "c1", title: "Senior Designer", company: "Ledgerly", score: 90, state: "Waiting" }],
  },
  drafts: [],
  scored: [],
  belowMinimum: [],
  defaultSource: "JSEARCH",
  timeZone: "Europe/Berlin",
};
const open = (changes: Partial<AgentDetailView> = {}) => render(<AgentDetailScreen view={{ ...view, ...changes }} countries={COUNTRIES} />);

beforeEach(() => vi.clearAllMocks());

describe("AgentDetailScreen (E16-6)", () => {
  it("shows the config on one side and the runs with the picked one's log on the other", async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByRole("heading", { level: 2, name: "Designers" })).toBeInTheDocument();
    expect(screen.getByText(/Next run: Wed 21 Oct, 07:00/)).toHaveTextContent("Weekdays at 07:00");
    expect(screen.getByLabelText("Name")).toHaveValue("Designers");
    expect(screen.getByRole("button", { name: "Mon" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Sun" })).toHaveAttribute("aria-pressed", "false");

    const runs = screen.getByRole("list", { name: "Runs" });
    const [latest, older] = within(runs).getAllByRole("button", { expanded: undefined });
    expect(latest).toHaveAttribute("aria-expanded", "true");
    expect(older).toHaveTextContent("Mon 19 Oct, 09:12 · Manual");
    expect(older).toHaveTextContent("Didn't finish");
    expect(screen.getByRole("list", { name: "Log" })).toHaveTextContent("07:00Searching for new postings07:01Scored 90: Senior Designer at Ledgerly");
    expect(screen.getByText("Seen before").nextElementSibling).toHaveTextContent("7");
    expect(screen.getByText("Senior Designer").closest("li")).toHaveTextContent("90Senior Designer · LedgerlyWaiting");

    await user.click(older);
    expect(router.replace).toHaveBeenCalledWith("/agent/a1?run=r1", { scroll: false });
  });

  it("saves a change at once, and rolls it back when it fails", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Sun" }));
    expect(saveAgent).toHaveBeenCalledWith({ id: "a1", days: [1, 2, 3, 4, 5, 0] });
    expect(screen.getByRole("button", { name: "Sun" })).toHaveAttribute("aria-pressed", "true");

    vi.mocked(saveAgent).mockResolvedValueOnce({ ok: false, error: "Nope." });
    await user.selectOptions(screen.getByLabelText("Runs in 24 hours"), "6");
    expect(saveAgent).toHaveBeenLastCalledWith({ id: "a1", maxRunsPerDay: 6 });
    expect(screen.getByLabelText("Runs in 24 hours")).toHaveValue("3");
  });

  it("searches its own job board, or the one in Settings", async () => {
    const user = userEvent.setup();
    open();
    const board = screen.getByLabelText("Job board");
    expect(board).toHaveDisplayValue("Settings default (JSearch)");
    await user.selectOptions(board, "NAUKRI");
    expect(saveAgent).toHaveBeenLastCalledWith({ id: "a1", source: "NAUKRI" });
    await user.selectOptions(board, "");
    expect(saveAgent).toHaveBeenLastCalledWith({ id: "a1", source: null });
  });

  it("turns off, and on only with a search", async () => {
    const user = userEvent.setup();
    const { unmount } = open();
    await user.click(screen.getByRole("switch", { name: "Active" }));
    expect(saveAgent).toHaveBeenCalledWith({ id: "a1", enabled: false });
    unmount();

    open({ config: { ...view.config, enabled: false, query: { ...query, keywords: "" } } });
    await user.click(screen.getByRole("switch", { name: "Active" }));
    expect(saveAgent).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("Set up the search before turning the agent on.");
  });

  it("runs now, and past its limits warns with Run anyway", async () => {
    const user = userEvent.setup();
    vi.mocked(runAgentNow).mockResolvedValueOnce({ ok: true, data: { jobId: null, warning: "This agent ran less than an hour ago. Its wait is over in 20 minutes." } });
    open();
    await user.click(screen.getByRole("button", { name: "Run now" }));
    expect(runAgentNow).toHaveBeenCalledWith({ id: "a1", force: false });
    expect(toast).toHaveBeenCalledWith("This agent ran less than an hour ago. Its wait is over in 20 minutes.", expect.objectContaining({ action: expect.objectContaining({ label: "Run anyway" }) }));

    const { action } = vi.mocked(toast).mock.calls.at(-1)![1]!;
    await act(async () => action!.onClick());
    expect(runAgentNow).toHaveBeenLastCalledWith({ id: "a1", force: true });
    expect(screen.getByRole("button", { name: "Running…" })).toBeInTheDocument();
  });

  it("points to Settings for what's set up there, and to the config for the rest", () => {
    const { unmount } = open({ setupProblem: "Choose a job source in Settings → Job search first.", setupSection: "jobs" });
    expect(screen.getByRole("link", { name: "Go to Settings → Job search" })).toHaveAttribute("href", "/settings?section=jobs");
    unmount();
    open({ setupProblem: "Add what this agent should look for first.", setupSection: null });
    expect(screen.getByRole("note")).toHaveTextContent("Add what this agent should look for. Set it up in the config below.");
  });

  it("deletes the agent after asking", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Delete agent" }));
    await user.click(within(screen.getByRole("alertdialog", { name: "Delete Designers?" })).getByRole("button", { name: "Delete agent" }));
    expect(deleteAgent).toHaveBeenCalledWith({ id: "a1" });
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/agent"));
  });

  it("shows what's waiting in its own tab", async () => {
    const user = userEvent.setup();
    open({ runs: [], run: null });
    expect(screen.getByText(/No runs yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Waiting" }));
    expect(screen.getByText("Nothing waiting yet. A run puts the postings that fit you best here.")).toBeInTheDocument();
  });
});
