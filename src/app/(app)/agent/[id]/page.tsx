import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { loadAgentDetail } from "@/lib/agent/view";
import { COUNTRIES } from "@/lib/job-search/countries";
import { prisma } from "@/lib/prisma";

import { AgentDetailScreen } from "./agent-detail-screen";

export async function generateMetadata({ params }: PageProps<"/agent/[id]">): Promise<Metadata> {
  const agent = await prisma.agent.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: agent?.name ?? "Agent" };
}

/** One job agent (E16-6): its config, its runs with their logs (`?run=`), and what's waiting. */
export default async function AgentPage({ params, searchParams }: PageProps<"/agent/[id]">) {
  const [{ id }, { run }] = await Promise.all([params, searchParams]);
  const view = await loadAgentDetail(id, typeof run === "string" ? run : undefined);
  if (!view) notFound();
  // Keyed, so switching agents starts from that agent's config.
  return <AgentDetailScreen key={view.id} view={view} countries={COUNTRIES} />;
}
