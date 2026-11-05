"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { PageHeader } from "@/components/page-header";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { useJob } from "@/hooks/use-job";
import type { AgentCardView } from "@/lib/agent/view";

import { createAgent } from "./actions";
import { RUN_STATUS_LABEL, RunDot } from "./run-status";

/**
 * The Agents screen (E16-6): every job agent at a glance, what it searches,
 * when it runs, how its last run went and what's waiting. Each opens to its
 * config and run history.
 */
export function AgentsScreen({ agents }: { agents: AgentCardView[] }) {
  const router = useRouter();
  const [creating, startTransition] = useTransition();
  const create = () =>
    startTransition(async () => {
      const result = toastResult(await createAgent({}));
      if (result.ok) router.push(`/agent/${result.data.id}`);
    });

  return (
    <>
      <PageHeader
        title="Agents"
        description="Each agent runs one search on the days you choose, scores the new postings against your profile, and keeps the best for you. Drafts wait for your review, and nothing is ever sent."
        actions={
          <Button aria-disabled={creating || undefined} onClick={() => !creating && create()}>
            {creating ? "Creating…" : "New agent"}
          </Button>
        }
      />
      <div className="px-10 pb-20">
        {agents.length === 0 ? (
          <p className="rounded-card border border-line-card bg-card px-5 py-4 text-sm text-muted">
            No agents yet. Make one with New agent: it starts off, so you can set up its search first.
          </p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => (
              <li key={agent.id}>
                <AgentCard agent={agent} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function AgentCard({ agent }: { agent: AgentCardView }) {
  const router = useRouter();
  const [jobId, setJobId] = useState(agent.runJobId);
  const job = useJob<{ message: string }>(jobId, 0, (update) => {
    if (update.status !== "DONE" && update.status !== "FAILED") return;
    setJobId(null);
    router.refresh();
  });
  const running = Boolean(jobId);
  const status = running ? "RUNNING" : agent.lastRun?.status;

  return (
    <Link
      href={`/agent/${agent.id}`}
      className="flex h-full flex-col gap-2 rounded-card border border-line-card bg-card px-5 py-4 text-ink hover:border-line-strong hover:bg-hover"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-field font-medium text-pretty">{agent.name}</h2>
        {agent.waiting > 0 && (
          <span className="shrink-0 rounded-full bg-selected px-2 py-0.5 text-xs font-medium text-primary-text">{agent.waiting} waiting</span>
        )}
      </div>
      <p className="line-clamp-2 text-sm text-muted">{agent.search ?? "No search yet"}</p>
      <p className="mt-auto flex flex-wrap items-center gap-x-1.5 pt-1 text-meta text-muted">
        <span className={agent.enabled ? "text-ink" : undefined}>{agent.enabled ? "Active" : "Off"}</span>
        <span aria-hidden="true">·</span>
        <span>{agent.schedule}</span>
      </p>
      <p className="flex items-center gap-2 text-meta text-muted">
        {status && <RunDot status={status} />}
        {running ? (
          <span role="status">{job?.step ?? "Starting the run…"}</span>
        ) : agent.lastRun ? (
          <span className="line-clamp-1">
            <span className="sr-only">{RUN_STATUS_LABEL[agent.lastRun.status]}: </span>
            {agent.lastRun.at} · {agent.lastRun.message ?? RUN_STATUS_LABEL[agent.lastRun.status]}
          </span>
        ) : agent.setupProblem ? (
          <span className="text-warning">{agent.setupProblem}</span>
        ) : (
          <span>{agent.nextRun ? `First run ${agent.nextRun}` : "Not run yet"}</span>
        )}
      </p>
    </Link>
  );
}
