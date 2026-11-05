"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { ScoreBadge } from "@/components/score-badge";
import { linksAttribution, SourceAttribution } from "@/components/source-attribution";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useJob } from "@/hooks/use-job";
import type { AgentCandidateView } from "@/lib/agent/view";

import { approveAgentDraft, dismissAgentCandidate, prepareAgentDraft, restoreAgentCandidate } from "./actions";

type DraftResult = { applicationId: string };

/**
 * What one agent found, waiting for a look (E16-6): the drafts it prepared,
 * the postings it scored, and those below its minimum on request. Nothing
 * here sends anything.
 */
export function WaitingQueue({
  drafts: allDrafts,
  scored: allScored,
  belowMinimum,
  autoDraft,
  minScore,
}: {
  drafts: AgentCandidateView[];
  scored: AgentCandidateView[];
  belowMinimum: AgentCandidateView[];
  autoDraft: boolean;
  minScore: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [showBelow, setShowBelow] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<AgentCandidateView | null>(null);

  const hide = (id: string, gone: boolean) =>
    setHidden((current) => {
      const next = new Set(current);
      if (gone) next.add(id);
      else next.delete(id);
      return next;
    });

  const dismiss = (candidate: AgentCandidateView) =>
    startTransition(async () => {
      hide(candidate.id, true);
      const result = await dismissAgentCandidate({ candidateId: candidate.id });
      if (!result.ok) {
        hide(candidate.id, false);
        return toast(result.error);
      }
      const undo = result.data.undo;
      if (!undo) return toast("Dismissed, with its draft. It won't come back.");
      toast("Dismissed. It won't come back.", {
        action: {
          label: "Undo",
          onClick: () =>
            void restoreAgentCandidate({ ...undo, reasons: stringList(undo.reasons), redFlags: stringList(undo.redFlags) }).then((restored) => {
              if (!toastResult(restored).ok) return;
              hide(candidate.id, false);
              router.refresh();
            }),
        },
      });
      router.refresh();
    });

  const drafts = allDrafts.filter((candidate) => !hidden.has(candidate.id));
  const scored = allScored.filter((candidate) => !hidden.has(candidate.id));
  const below = belowMinimum.filter((candidate) => !hidden.has(candidate.id));
  const empty = drafts.length === 0 && scored.length === 0;

  return (
    <div className="flex flex-col gap-8">
    <Section title="Drafts to review" count={drafts.length}>
      {drafts.length === 0 ? (
        <Empty>
          {autoDraft
            ? "No drafts yet. After a run, the best new postings get a draft here."
            : "No drafts yet. Prepare one from a scored posting, or turn on Prepare drafts on its own."}
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {drafts.map((candidate) => (
            <li key={candidate.id}>
              <CandidateCard candidate={candidate}>
                <Link href={`/applications/${candidate.applicationId}`} className={buttonClassName("primary", "sm", "hover:text-on-primary")}>
                  Review draft
                </Link>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    startTransition(async () => {
                      if (toastResult(await approveAgentDraft({ candidateId: candidate.id })).ok) router.refresh();
                    })
                  }
                >
                  Approve
                </Button>
                <OpenPosting url={candidate.url} />
                <Button variant="danger-text" size="sm" className="ml-auto" onClick={() => setConfirming(candidate)}>
                  Dismiss
                </Button>
              </CandidateCard>
            </li>
          ))}
        </ul>
      )}
    </Section>

    <Section title="Scored postings" count={scored.length}>
      {scored.length === 0 ? (
        <Empty>{empty ? "Nothing waiting yet. A run puts the postings that fit you best here." : "No postings waiting for a draft."}</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {scored.map((candidate) => (
            <li key={candidate.id}>
              <ScoredCard candidate={candidate} onDismiss={() => dismiss(candidate)} />
            </li>
          ))}
        </ul>
      )}
      {below.length > 0 && (
        <div className="flex flex-col gap-3">
          <button type="button" aria-expanded={showBelow} onClick={() => setShowBelow(!showBelow)} className="w-fit text-meta text-muted underline underline-offset-2 hover:text-ink">
            {below.length} below your minimum score of {minScore} · {showBelow ? "Hide" : "Show"}
          </button>
          {showBelow && (
            <ul className="flex flex-col gap-3">
              {below.map((candidate) => (
                <li key={candidate.id}>
                  <ScoredCard candidate={candidate} onDismiss={() => dismiss(candidate)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>

  <ConfirmDialog
    open={confirming !== null}
    onOpenChange={(open) => !open && setConfirming(null)}
    title="Dismiss this draft?"
    description="Its resume, cover letter and chat are deleted, and the posting won't come back."
    confirmLabel="Dismiss draft"
    onConfirm={() => {
      if (confirming) dismiss(confirming);
      setConfirming(null);
    }}
  />
    </div>
  );
}

const stringList = (value: unknown): string[] | null => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : null);

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = `agent-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="font-serif text-section">
          {title}
        </h2>
        <p className="text-meta text-muted">{count} waiting</p>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-card border border-line-card bg-card px-5 py-4 text-sm text-muted">{children}</p>;
}

function OpenPosting({ url }: { url: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClassName("secondary", "sm")}>
      Open posting <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** A posting the agent found: what it is, its score and why. The actions go below. */
function CandidateCard({ candidate, children }: { candidate: AgentCandidateView; children: ReactNode }) {
  return (
    <Card padding="none" className="flex flex-col gap-3.5 px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="font-serif text-[20px] leading-tight text-pretty">{candidate.title}</h3>
          {candidate.company && <p className="text-sm text-ink">{candidate.company}</p>}
          {candidate.facts && <p className="text-meta text-muted">{candidate.facts}</p>}
          {candidate.origin && <p className="text-xs text-muted">{candidate.origin}</p>}
          {/* As the source's terms ask (E14-2); the origin names the others. */}
          {linksAttribution(candidate.source) && <SourceAttribution source={candidate.source} url={candidate.url} className="mt-1.5 self-start" />}
        </div>
        <ScoreBadge score={candidate.score} />
      </div>
      {candidate.reasons.length > 0 && (
        <ul aria-label="Why it fits" className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
          {candidate.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      )}
      {candidate.redFlags.length > 0 && (
        <div className="rounded-card bg-warning-surface px-3.5 py-2.5 text-meta text-warning">
          <p className="font-medium">Worth knowing</p>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
            {candidate.redFlags.map((flag, index) => (
              <li key={index}>{flag}</li>
            ))}
          </ul>
        </div>
      )}
      {candidate.error && (
        <p role="alert" className="text-meta text-error">
          {candidate.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-3.5">{children}</div>
    </Card>
  );
}

/** A scored posting: Prepare draft (following the job while it writes), Open posting, Dismiss. */
function ScoredCard({ candidate, onDismiss }: { candidate: AgentCandidateView; onDismiss: () => void }) {
  const router = useRouter();
  const [jobId, setJobId] = useState(candidate.draftJobId);
  const [starting, startTransition] = useTransition();
  const job = useJob<DraftResult>(jobId, 0, (update) => {
    if (update.status === "DONE") {
      setJobId(null);
      toast("The draft is ready for your review.");
      router.refresh();
    } else if (update.status === "FAILED") {
      setJobId(null);
      toast(update.error ?? "The draft couldn't be prepared.");
      router.refresh();
    }
  });
  const preparing = starting || Boolean(jobId);

  const prepare = () =>
    startTransition(async () => {
      const result = toastResult(await prepareAgentDraft({ candidateId: candidate.id }));
      if (!result.ok) return;
      if (result.data.applicationId) router.refresh();
      else setJobId(result.data.jobId);
    });

  return (
    <CandidateCard candidate={candidate}>
      <Button size="sm" aria-disabled={preparing || undefined} onClick={() => !preparing && prepare()}>
        {preparing ? "Preparing draft…" : "Prepare draft"}
      </Button>
      <OpenPosting url={candidate.url} />
      {preparing && job?.step && (
        <span role="status" className="text-meta text-muted">
          {job.step}
        </span>
      )}
      <Button variant="danger-text" size="sm" className="ml-auto" onClick={onDismiss}>
        Dismiss
      </Button>
    </CandidateCard>
  );
}
