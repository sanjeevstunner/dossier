"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { PageHeader } from "@/components/page-header";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import { formatShortDate } from "@/lib/dates";
import { statusInfo } from "@/lib/status";

import { resolveAllNaukriConflicts, resolveNaukriConflict } from "../actions";
import { NaukriBadge } from "../naukri-badge";

export type ReviewItem = {
  id: string;
  company: string;
  title: string;
  status: ApplicationStatus;
  statusSince: string | null;
  word: string;
  naukriStatus: ApplicationStatus;
};

function Side({ heading, status, detail }: { heading: string; status: ApplicationStatus; detail: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-meta text-muted">{heading}</span>
      <span className="flex items-center gap-2 font-medium">
        <StatusDot status={status} />
        {statusInfo(status).label}
      </span>
      <span className="truncate text-meta text-muted">{detail}</span>
    </div>
  );
}

/** The diff checker: what you have next to what Naukri says, one decision per application. */
export function ReviewScreen({ items }: { items: ReviewItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const one = (item: ReviewItem, choice: "naukri" | "dossier") =>
    start(async () => {
      if (toastResult(await resolveNaukriConflict({ id: item.id, choice })).ok) router.refresh();
    });
  const all = (choice: "naukri" | "dossier") =>
    start(async () => {
      const result = toastResult(await resolveAllNaukriConflicts({ choice }));
      if (result.ok) {
        toast(choice === "naukri" ? `Took Naukri's status for ${result.data}.` : `Kept ${result.data} as they are.`);
        router.refresh();
      }
    });

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        before={
          <Link href="/applications" className="text-sm text-muted hover:text-ink">
            Applications /
          </Link>
        }
        title="Review Naukri changes"
        description="Applications you moved yourself, where Naukri shows something else. Nothing changes until you decide, and each Naukri status is only asked about once."
        actions={
          items.length > 1 && (
            <>
              <Button variant="secondary" size="sm" disabled={pending} onClick={() => all("dossier")}>
                Keep mine for all
              </Button>
              <Button variant="secondary" size="sm" disabled={pending} onClick={() => all("naukri")}>
                Use Naukri for all
              </Button>
            </>
          )
        }
      />
      {items.length === 0 ? (
        <div className="mx-10 mb-16 rounded-panel border border-line-card bg-card px-5 py-9 text-center text-sm text-muted">Nothing to review.</div>
      ) : (
        <ul className="mx-10 mb-16 flex max-w-[880px] flex-col gap-3" aria-label="Applications to review">
          {items.map((item) => (
            <li key={item.id} className="grid gap-4 rounded-panel border border-line-card bg-card px-6 py-5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <Link href={`/applications/${item.id}?tab=notes`} className="block truncate font-medium hover:underline">
                  {item.title || item.company}
                </Link>
                <span className="text-meta text-muted">
                  {item.company}
                  <NaukriBadge />
                </span>
              </div>
              <Side heading="In Dossier" status={item.status} detail={item.statusSince ? `Since ${formatShortDate(new Date(item.statusSince))}` : "Set by you"} />
              <Side heading="On Naukri" status={item.naukriStatus} detail={`“${item.word}”`} />
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => one(item, "dossier")}>
                  Keep mine
                </Button>
                <Button variant="primary" size="sm" disabled={pending} onClick={() => one(item, "naukri")}>
                  Use Naukri
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
