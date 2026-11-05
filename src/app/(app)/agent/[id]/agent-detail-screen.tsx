"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { useJob } from "@/hooks/use-job";
import type { AgentDetailView, AgentEditable, AgentRunDetail } from "@/lib/agent/view";
import type { Country } from "@/lib/job-search/countries";
import { cn } from "@/lib/cn";

import type { SearchFieldErrors } from "../../jobs/search-fields";
import { createAgent, deleteAgent, runAgentNow, saveAgent } from "../actions";
import { RUN_STATUS_LABEL, RunDot } from "../run-status";
import { WaitingQueue } from "../waiting-queue";
import { AgentConfig, type ConfigChange } from "./agent-config";

type ScanResult = { message: string };

const SETTINGS = {
  ai: { href: "/settings?section=ai", label: "Settings → AI provider" },
  jobs: { href: "/settings?section=jobs", label: "Settings → Job search" },
} as const;

/**
 * One job agent (E16-6): its config on the left, its runs with their logs
 * and what it found waiting for a look on the right. Nothing here sends
 * anything.
 */
export function AgentDetailScreen({ view, countries }: { view: AgentDetailView; countries: readonly Country[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [config, setConfig] = useState<AgentEditable>(view.config);
  const latest = useRef(config);
  const [errors, setErrors] = useState<SearchFieldErrors>({});
  const [runJobId, setRunJobId] = useState(view.runJobId);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState(view.drafts.length + view.scored.length > 0 && view.runs.length === 0 ? "waiting" : "history");

  const change = (next: ConfigChange) => {
    const previous = latest.current;
    latest.current = { ...previous, ...next };
    setConfig(latest.current);
    return previous;
  };

  const lastStep = useRef<string | null>(null);
  const run = useJob<ScanResult>(runJobId, 0, (job) => {
    // Each new step is in the log too: show it.
    if (job.step !== lastStep.current) {
      lastStep.current = job.step ?? null;
      router.refresh();
    }
    if (job.status !== "DONE" && job.status !== "FAILED") return;
    setRunJobId(null);
    toast(job.status === "DONE" ? (job.result?.message ?? "The run is done.") : (job.error ?? "The run didn't finish."));
    router.replace(pathname, { scroll: false });
    router.refresh();
  });
  const running = Boolean(runJobId) && (!run || run.status === "QUEUED" || run.status === "RUNNING");

  const runNow = (force = false) =>
    startTransition(async () => {
      const result = await runAgentNow({ id: view.id, force });
      if (!result.ok) return toast(result.error);
      if (result.data.warning) return toast(result.data.warning, { action: { label: "Run anyway", onClick: () => runNow(true) } });
      setRunJobId(result.data.jobId);
      setTab("history");
      router.replace(pathname, { scroll: false });
      router.refresh();
    });

  const turnOn = (on: boolean) => {
    if (on) {
      const problems = {
        keywords: config.query.keywords.trim() ? undefined : "Type what the agent should look for.",
        country: config.query.country ? undefined : "Choose a country.",
      };
      setErrors(problems);
      if (problems.keywords || problems.country) return toast("Set up the search before turning the agent on.");
    }
    const previous = change({ enabled: on });
    // With the search, so one still being typed is saved too.
    void saveAgent({ id: view.id, enabled: on, ...(on ? { query: config.query } : {}) }).then((result) => {
      if (!result.ok) {
        change(previous);
        toast(result.error);
      } else router.refresh();
    });
  };

  const waiting = view.drafts.length + view.scored.length;

  return (
    <>
      <PageHeader
        before={<Breadcrumb view={view} name={config.name} />}
        title={<span className="sr-only">{config.name}</span>}
        actions={
          <>
            <Button aria-disabled={running || pending || undefined} onClick={() => !running && !pending && runNow()}>
              {running ? "Running…" : "Run now"}
            </Button>
            <Toggle label="Active" checked={config.enabled} onCheckedChange={turnOn} className="pl-2" />
          </>
        }
      />
      <div className="flex flex-col gap-6 px-10 pb-20">
        <div className="flex flex-col gap-1">
          <h2 className="font-serif text-section text-pretty">{config.name || "Untitled agent"}</h2>
          <p className="text-meta text-muted">
            {config.enabled ? (view.nextRun ? `Next run: ${view.nextRun}` : "No days chosen: it only runs with Run now.") : "Off. Nothing is searched or scored until it's on."}
            {" · "}
            {view.schedule}
          </p>
        </div>
        <Notices view={view} />

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <Card padding="none" className="px-7 py-6">
            <AgentConfig
              id={view.id}
              config={config}
              onChange={change}
              defaultSource={view.defaultSource}
              countries={countries}
              timeZone={view.timeZone}
              errors={errors}
              setErrors={setErrors}
              onDelete={() => setDeleting(true)}
            />
          </Card>

          <Tabs value={tab} onValueChange={setTab} className="flex min-w-0 flex-col gap-4">
            <TabsList>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="waiting">Waiting{waiting > 0 ? ` (${waiting})` : ""}</TabsTrigger>
            </TabsList>
            <TabsContent value="history">
              <History view={view} liveStep={running ? (run?.step ?? "Starting the run…") : null} />
            </TabsContent>
            <TabsContent value="waiting">
              <WaitingQueue drafts={view.drafts} scored={view.scored} belowMinimum={view.belowMinimum} autoDraft={config.autoDraft} minScore={config.minScore} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${config.name || "this agent"}?`}
        description="Its config and run history are deleted. Drafts it prepared and postings it found stay, so they don't come back."
        confirmLabel="Delete agent"
        onConfirm={() =>
          startTransition(async () => {
            const result = await deleteAgent({ id: view.id });
            if (!result.ok) return toast(result.error);
            router.push("/agent");
          })
        }
      />
    </>
  );
}

/** "Agents / Job agent ▾": back to the list, or across to another agent. */
function Breadcrumb({ view, name }: { view: AgentDetailView; name: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
      <Link href="/agent" className="text-muted hover:text-ink">
        Agents
      </Link>
      <span aria-hidden="true" className="text-faint">
        /
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="text" size="sm" aria-label={`Switch agent: ${name}`} className="min-w-0 data-[state=open]:text-ink">
            <span className="truncate">{name || "Untitled agent"}</span>
            <span aria-hidden="true" className="text-[10px]">
              ▼
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto">
          <DropdownMenuRadioGroup value={view.id} onValueChange={(id) => id !== view.id && router.push(`/agent/${id}`)}>
            {view.agents.map((agent) => (
              <DropdownMenuRadioItem key={agent.id} value={agent.id}>
                {agent.id === view.id ? name || "Untitled agent" : agent.name}
                {!agent.enabled && <span className="text-meta text-muted"> · off</span>}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              startTransition(async () => {
                const result = await createAgent({});
                if (result.ok) router.push(`/agent/${result.data.id}`);
                else toast(result.error);
              })
            }
          >
            New agent
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}

/** Why the agent can't run, and where to fix it; a nudge when Run now would be past its limits. */
function Notices({ view }: { view: AgentDetailView }) {
  const note = (children: ReactNode) => (
    <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
      {children}
    </p>
  );
  if (view.setupProblem) {
    if (!view.setupSection) return note(`${view.setupProblem.replace(/ first\.$/, ".")} Set it up in the config below.`);
    return note(
      <>
        {view.setupProblem.replace(/ in Settings → [^.]+ first\.$/, ".")}{" "}
        <Link href={SETTINGS[view.setupSection].href} className="font-medium text-warning underline underline-offset-2">
          Go to {SETTINGS[view.setupSection].label}
        </Link>
      </>,
    );
  }
  if (view.limitWarning) return note(`${view.limitWarning} Run now will ask first.`);
  return null;
}

/** The agent's runs, newest first; the one picked opens to its log. */
function History({ view, liveStep }: { view: AgentDetailView; liveStep: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  if (view.runs.length === 0) {
    return (
      <p className="rounded-card border border-line-card bg-card px-5 py-4 text-sm text-muted">
        {liveStep ?? "No runs yet. Each run, scheduled or Run now, is kept here with its log."}
      </p>
    );
  }
  return (
    <ul aria-label="Runs" className="flex flex-col">
      {view.runs.map((run) => {
        const open = view.run?.id === run.id;
        return (
          <li key={run.id} className="border-b border-line last:border-b-0">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => router.replace(open ? pathname : `${pathname}?run=${run.id}`, { scroll: false })}
              className={cn("flex w-full items-center gap-3 rounded-control px-3 py-3 text-left text-sm hover:bg-hover", open && "bg-hover")}
            >
              <span className="min-w-0 flex-1">
                <span className="text-ink">{run.at}</span>
                {run.manual && <span className="text-muted"> · Manual</span>}
                {run.message && <span className="block truncate text-meta text-muted">{run.message}</span>}
              </span>
              <span className="sr-only">{RUN_STATUS_LABEL[run.status]}</span>
              <RunDot status={run.status} />
            </button>
            {open && view.run && <RunLog run={view.run} liveStep={run.status === "RUNNING" ? liveStep : null} />}
          </li>
        );
      })}
    </ul>
  );
}

function RunLog({ run, liveStep }: { run: AgentRunDetail; liveStep: string | null }) {
  const counts = [
    ["Found", run.counts.found],
    ["New", run.counts.fresh],
    ["Seen before", run.counts.skipped],
    ["Scored", run.counts.scored],
    ["Drafts", run.counts.drafted],
  ] as const;
  return (
    <div className="flex flex-col gap-4 px-3 pt-1 pb-5">
      {run.status !== "RUNNING" && (
        <dl className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {counts.map(([label, value]) => (
            <div key={label} className="rounded-card border border-line-card bg-card px-3 py-2">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="text-field font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <ol aria-label="Log" className="flex flex-col gap-1.5 border-l border-line pl-4 text-meta">
        {run.steps.map((step, index) => (
          <li key={index} className="flex flex-col sm:flex-row sm:gap-3">
            <span className="shrink-0 text-muted tabular-nums">{step.at.replace(/^.*, /, "")}</span>
            <span className="text-ink">{step.text}</span>
          </li>
        ))}
        {liveStep && (
          <li role="status" className="text-muted">
            {liveStep}…
          </li>
        )}
        {run.steps.length === 0 && !liveStep && <li className="text-muted">Nothing was logged for this run.</li>}
      </ol>
      {run.postings.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-meta font-medium">What it scored</h4>
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line-card bg-card">
            {run.postings.map((posting) => (
              <li key={posting.id} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
                <span className="w-8 shrink-0 font-medium tabular-nums">{posting.score}</span>
                <span className="min-w-0 flex-1 truncate">
                  {posting.title}
                  {posting.company && <span className="text-muted"> · {posting.company}</span>}
                </span>
                <span className="shrink-0 text-meta text-muted">{posting.state}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
