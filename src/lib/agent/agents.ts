import "server-only";

import type { Agent } from "@/generated/prisma/client";
import { EMPTY_QUERY, searchQuerySchema, type SearchQuery } from "@/lib/job-search/search";
import { prisma } from "@/lib/prisma";

// The job agents (E16): each one search, run on its own weekdays and hour.

export type AgentConfig = Omit<Agent, "query"> & { query: SearchQuery };

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** A stored agent with its search read, as Find jobs asks it. */
export function configOf(agent: Agent): AgentConfig {
  return {
    ...agent,
    query: searchQuerySchema.catch(EMPTY_QUERY).parse(agent.query),
    days: [...new Set(agent.days.filter((day) => day >= 0 && day <= 6))].sort(),
  };
}

export async function loadAgent(id: string): Promise<AgentConfig | null> {
  const agent = await prisma.agent.findUnique({ where: { id } });
  return agent && configOf(agent);
}

/** Oldest first, so a new one goes last and the order stays put. */
export async function listAgents(): Promise<AgentConfig[]> {
  return (await prisma.agent.findMany({ orderBy: { createdAt: "asc" } })).map(configOf);
}
