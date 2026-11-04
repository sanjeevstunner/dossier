import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentCardView } from "@/lib/agent/view";

import { createAgent } from "./actions";
import { AgentsScreen } from "./agents-screen";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/agent" }));
vi.mock("@/hooks/use-job", () => ({ useJob: () => ({ status: "RUNNING", step: "Scoring 3 postings" }) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean }) => result }));
vi.mock("./actions", () => ({ createAgent: vi.fn(async () => ({ ok: true, data: { id: "new" } })) }));

const agent = (id: string, extra: Partial<AgentCardView> = {}): AgentCardView => ({
  id,
  name: `Agent ${id}`,
  enabled: true,
  search: "Product designer · Rotterdam, 25 km · via JSearch",
  schedule: "Weekdays at 07:00",
  nextRun: "Wed 21 Oct, 07:00",
  lastRun: { id: "r1", at: "Tue 20 Oct, 07:00", manual: false, status: "DONE", message: "2 new postings are waiting for a look." },
  waiting: 2,
  runJobId: null,
  setupProblem: null,
  ...extra,
});

beforeEach(() => vi.clearAllMocks());

describe("AgentsScreen (E16-6)", () => {
  it("shows each agent's search, schedule, last run and what's waiting, opening to it", () => {
    render(<AgentsScreen agents={[agent("a"), agent("b", { enabled: false, waiting: 0, lastRun: null, nextRun: null, setupProblem: "Add what this agent should look for first." })]} />);
    expect(screen.getByRole("heading", { level: 1, name: "Agents" })).toBeInTheDocument();
    const [first, second] = screen.getAllByRole("listitem");
    expect(within(first).getByRole("link")).toHaveAttribute("href", "/agent/a");
    expect(first).toHaveTextContent("Agent a2 waitingProduct designer · Rotterdam, 25 km · via JSearchActive·Weekdays at 07:00");
    expect(first).toHaveTextContent("Tue 20 Oct, 07:00 · 2 new postings are waiting for a look.");
    expect(second).toHaveTextContent("Off·Weekdays at 07:00");
    expect(second).toHaveTextContent("Add what this agent should look for first.");
    expect(second).not.toHaveTextContent("waiting");
  });

  it("follows a run under way", () => {
    render(<AgentsScreen agents={[agent("a", { runJobId: "job-1" })]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Scoring 3 postings");
  });

  it("makes a new agent and opens it", async () => {
    const user = userEvent.setup();
    render(<AgentsScreen agents={[]} />);
    expect(screen.getByText(/No agents yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New agent" }));
    expect(createAgent).toHaveBeenCalledWith({});
    expect(router.push).toHaveBeenCalledWith("/agent/new");
  });
});
