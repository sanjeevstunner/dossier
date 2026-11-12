"use client";

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode, type SyntheticEvent } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import type { ApplicationRow, SavedRow } from "@/lib/applications-data";
import { statusLabel } from "@/lib/applications-list";
import { cn } from "@/lib/cn";
import { useJob } from "@/hooks/use-job";

import { startCatchingUp } from "./[id]/actions";
import { startEasyApplyForApplication } from "./actions";
import { RowMenu } from "./row-menu";

/**
 * The board (LST-3, LST-4): a column per status in the filter, cards newest
 * first. Drag a card to another column to move it; each card also has a
 * "Move to…" menu for the keyboard and touch. Clicking a card opens it.
 * It fills the height it's given: each column's cards scroll on their own.
 *
 * Saved (postings kept in Find jobs) and Scored come before Draft. They fill
 * themselves: scoring a saved posting makes it an application in Scored, and
 * writing its resume makes it a draft. Nothing can be dragged into them, and
 * Saved cards don't move at all; a scored card can only go to Sent.
 */
export function Board({
  rows,
  saved,
  statuses,
  onMove,
}: {
  rows: ApplicationRow[];
  saved: SavedRow[];
  statuses: ApplicationStatus[];
  onMove: (row: ApplicationRow, to: ApplicationStatus) => void;
}) {
  const [dragging, setDragging] = useState<ApplicationRow | null>(null);
  // A drag ends with a click on some browsers; it mustn't open the card.
  const draggedAt = useRef(0);
  const sensors = useSensors(
    // A few pixels of movement first, so a click still opens the card…
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // …and a press-and-hold on touch screens, so swiping still scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const start = ({ active }: DragStartEvent) => setDragging(rows.find((row) => row.id === active.id) ?? null);
  const end = ({ active, over }: DragEndEvent) => {
    draggedAt.current = Date.now();
    setDragging(null);
    const row = rows.find((entry) => entry.id === active.id);
    const to = over?.id as ApplicationStatus | undefined;
    if (row && to && to !== row.status && to !== "SCORED") onMove(row, to);
  };

  const byNewest = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
  const name = (row: ApplicationRow) => [row.role, row.company].filter(Boolean).join(" at ");

  return (
    <DndContext
      id="applications-board"
      sensors={sensors}
      onDragStart={start}
      onDragEnd={end}
      onDragCancel={() => setDragging(null)}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${name(rows.find((row) => row.id === active.id)!)}.`,
          onDragOver: ({ over }) => (over ? `Over ${statusLabel(over.id as ApplicationStatus)}.` : "Not over a column."),
          onDragEnd: ({ over }) => (over ? `Dropped on ${statusLabel(over.id as ApplicationStatus)}.` : "Dropped back where it was."),
          onDragCancel: () => "Moving cancelled.",
        },
      }}
    >
      {/* Relative, so screen-reader-only text inside is clipped with the rest
          instead of widening the page. */}
      <div className="relative min-h-0 flex-1 scrollbar-subtle overflow-x-auto overflow-y-hidden px-10 pt-1.5 pb-5">
        <div className="flex h-full w-max items-stretch gap-3.5">
          {saved.length > 0 && (
            <Column id="SAVED" label="Saved" dot="draft" count={saved.length} disabled>
              {saved.map((posting) => (
                <SavedCard key={posting.id} posting={posting} />
              ))}
            </Column>
          )}
          {statuses.map((status) => {
            const cards = byNewest.filter((row) => row.status === status);
            return (
              <Column key={status} id={status} label={statusLabel(status)} dot={status} count={cards.length}>
                {cards.map((row) => (
                  <Card
                    key={row.id}
                    row={row}
                    dimmed={dragging?.id === row.id}
                    onOpen={(event) => Date.now() - draggedAt.current < 300 && event.preventDefault()}
                    onMove={(to) => onMove(row, to)}
                  />
                ))}
              </Column>
            );
          })}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>{dragging && <CardFace row={dragging} lifted />}</DragOverlay>
    </DndContext>
  );
}

function Column({
  id,
  label,
  dot,
  count,
  disabled = false,
  children,
}: {
  id: string;
  label: string;
  dot: ApplicationStatus | "draft";
  count: number;
  /** Nothing can be dropped here. */
  disabled?: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  const headingId = `board-${id}`;
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={cn(
        "flex min-h-0 w-[252px] flex-none flex-col gap-2.5 rounded-panel p-3 outline-[1.5px] -outline-offset-2 motion-safe:transition-colors",
        isOver && !disabled ? "bg-selected outline-dashed outline-line-strong" : "bg-track outline-transparent",
      )}
    >
      <h2 id={headingId} className="flex items-center gap-2 px-1 pt-1 pb-0.5">
        <StatusDot status={dot === "draft" ? "DRAFT" : dot} />
        <span className="flex-1 text-control font-medium">{label}</span>{" "}
        <span className="text-label text-muted tabular-nums">
          {count}{" "}
          <span className="sr-only">{count === 1 ? "application" : "applications"}</span>
        </span>
      </h2>
      {count > 0 ? (
        // Scrolls on its own, out to the column's edges so its scrollbar sits
        // at the side and focus rings aren't cut off; the heading stays.
        <ul className="-mx-3 -mt-1 -mb-3 flex min-h-0 flex-1 scrollbar-subtle flex-col gap-2.5 overflow-y-auto px-3 pt-1 pb-3">{children}</ul>
      ) : (
        <p className="px-2.5 py-5 text-center text-label text-muted">Nothing here yet</p>
      )}
    </section>
  );
}

function Card({
  row,
  dimmed,
  onOpen,
  onMove,
}: {
  row: ApplicationRow;
  dimmed: boolean;
  onOpen: (event: React.MouseEvent) => void;
  onMove: (to: ApplicationStatus) => void;
}) {
  const { setNodeRef, listeners } = useDraggable({ id: row.id });
  return (
    <li ref={setNodeRef} {...listeners} className={cn("relative touch-manipulation", dimmed && "opacity-40")}>
      <CardFace row={row} onOpen={onOpen} actions={row.status === "SCORED" ? <ScoredActions row={row} /> : undefined} />
      <div className="absolute top-2 right-2">
        <RowMenu row={row} onMove={onMove} />
      </div>
    </li>
  );
}

/** A saved posting: read-only, it opens in Find jobs' Saved tab, where it's scored. */
function SavedCard({ posting }: { posting: SavedRow }) {
  return (
    <li className="relative">
      <div className="flex flex-col gap-1.5 rounded-[10px] border border-line-card bg-card p-3.5 shadow-control hover:border-line-strong">
        <p className="text-label text-muted">{posting.company || "No company"}</p>
        <Link
          href="/jobs?view=saved"
          className="text-field leading-[1.35] font-medium text-pretty text-ink after:absolute after:inset-0 after:rounded-[10px] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary"
        >
          {posting.title}
        </Link>
        {posting.place && <p className="text-label text-muted">{posting.place}</p>}
        <p className="mt-0.5 flex justify-between gap-2 border-t border-line pt-1.5 text-xs text-muted">
          <span>Not scored yet</span>
          <span>{posting.saved}</span>
        </p>
      </div>
    </li>
  );
}

/** What a card shows; also the copy that follows the pointer while dragging. */
function CardFace({ row, lifted = false, onOpen, actions }: { row: ApplicationRow; lifted?: boolean; onOpen?: (event: React.MouseEvent) => void; actions?: ReactNode }) {
  const place = [row.location, row.mode].filter(Boolean).join(" · ");
  return (
    <div
      className={cn(
        "group flex cursor-grab flex-col gap-1.5 rounded-[10px] border border-line-card bg-card p-3.5 pr-9 shadow-control hover:border-line-strong",
        lifted && "cursor-grabbing shadow-menu",
      )}
    >
      <p className="flex items-baseline justify-between gap-2 text-label text-muted">
        {row.company || "No company"}
        {row.archived && <span className="rounded-[6px] bg-track px-1.5 text-xs">Archived</span>}
      </p>
      {/* The link covers the card, so clicking anywhere opens it. */}
      <Link
        href={`/applications/${row.id}`}
        onClick={onOpen}
        draggable={false}
        className="text-field leading-[1.35] font-medium text-pretty text-ink after:absolute after:inset-0 after:rounded-[10px] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary"
      >
        {row.role}
      </Link>
      {place && <p className="text-label text-muted">{place}</p>}
      {row.status === "DRAFT" && row.deadline && (
        <p className="flex">
          <span className="rounded-[6px] bg-warning-surface px-2 py-[3px] text-xs text-warning">Apply by {row.deadline}</span>
        </p>
      )}
      {row.status === "SCORED" && (
        <p className="flex">
          <span className="rounded-[6px] bg-track px-2 py-[3px] text-xs">
            {row.score === null ? "Scored" : `${row.score}/100 fit`}
            {row.hasUploadedResume && " · resume uploaded"}
          </span>
        </p>
      )}
      {actions}
      <p className="mt-0.5 flex justify-between gap-2 border-t border-line pt-1.5 text-xs text-muted">
        <span>{row.match ? `${row.match.hit}/${row.match.total} match` : "Not matched"}</span>
        <span>{row.updated}</span>
      </p>
    </div>
  );
}

/**
 * What a scored application can do before it's a draft: have its resume
 * written, or be applied for by the agent (Naukri postings). Opening it, or
 * uploading a resume, is on the card's link. Its job's step shows here; when
 * it ends the board reloads and the card moves on.
 */
function ScoredActions({ row }: { row: ApplicationRow }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);
  // "Confirm easy apply answers" is on: the agent stopped before sending, for the user's answers.
  const [needsAnswers, setNeedsAnswers] = useState(false);
  const job = useJob(jobId, 0, (update) => {
    if (update.status === "DONE" || update.status === "FAILED") {
      if (update.status === "DONE" && (update.result as { review?: unknown } | null)?.review) setNeedsAnswers(true);
      if (update.status === "FAILED") toast(update.error ?? "That didn't work.");
      setJobId(null);
      router.refresh();
    }
  });
  const running = jobId !== null;
  // Over the card's link, and out of the drag: pressing here mustn't start one or open the card.
  const stop = (event: SyntheticEvent) => event.stopPropagation();
  const run = async (start: () => Promise<{ ok: true; data: string } | { ok: false; error: string }>) => {
    const result = await start();
    if (!result.ok) return void toast(result.error);
    setJobId(result.data);
  };
  return (
    <div className="relative z-10 flex flex-wrap items-center gap-1.5" onMouseDown={stop} onTouchStart={stop} onClick={stop}>
      {!row.hasUploadedResume && (
        <Button variant="secondary" size="sm" disabled={running} onClick={() => void run(async () => {
          const result = await startCatchingUp({ id: row.id, kind: "resume" });
          return result.ok ? { ok: true, data: result.data } : result;
        })}>
          Write resume
        </Button>
      )}
      {row.agentApply && (
        <Button variant="primary" size="sm" disabled={running} onClick={() => void run(async () => {
          const result = await startEasyApplyForApplication({ id: row.id });
          return result.ok ? { ok: true, data: result.data.jobId } : result;
        })}>
          Apply with agent
        </Button>
      )}
      {running && <span role="status" className="text-xs text-muted">{job?.step ?? "Starting…"}</span>}
      {needsAnswers && !running && (
        <span role="status" className="text-xs text-muted">
          Needs your answers before it&apos;s sent. Open the application.
        </span>
      )}
    </div>
  );
}
