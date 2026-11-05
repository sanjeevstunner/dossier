import type { Metadata } from "next";

import { loadAgentList } from "@/lib/agent/view";

import { AgentsScreen } from "./agents-screen";

export const metadata: Metadata = { title: "Agents" };

/** The job agents (E16-6): each one's search, schedule, last run and what's waiting. */
export default async function AgentsPage() {
  return <AgentsScreen agents={await loadAgentList()} />;
}
