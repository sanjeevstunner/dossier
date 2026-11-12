"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";

import { changeStatus } from "@/components/change-status";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusDot } from "@/components/ui/status-dot";
import { ApplicationStatus } from "@/generated/prisma/enums";
import { STATUSES, statusInfo } from "@/lib/status";

import { InterviewDate } from "./interview-date";

/**
 * The status pill and its menu (APP-2), plus "Mark as sent" while the
 * application is a draft, and the next interview's date while it's in
 * Interview (E9-9). The new status shows at once; the server's answer (and
 * its toast with Undo) follows. Moving to Interview asks for the date once
 * the menu has closed.
 */
export function StatusControl({
  id,
  status,
  interviewAt = null,
  timeZone,
  hasUploadedResume = false,
}: {
  id: string;
  status: ApplicationStatus;
  /** A scored application can only be sent with a resume the user uploaded. */
  hasUploadedResume?: boolean;
  interviewAt?: Date | null;
  timeZone?: string;
}) {
  const [shown, show] = useOptimistic(status);
  const [, startTransition] = useTransition();
  const [interview, setInterview] = useState<"edit" | "ask" | null>(null);
  const askForDate = useRef(false);
  const { label } = statusInfo(shown);
  // Scored moves to Draft by itself, when the resume is written: from there the user can only send it.
  const scored = shown === ApplicationStatus.SCORED;
  const choices = STATUSES.filter((entry) => (scored ? entry.value === ApplicationStatus.SCORED || entry.value === ApplicationStatus.SENT : entry.value !== ApplicationStatus.SCORED));

  const move = (to: ApplicationStatus) => {
    if (to === shown) return;
    askForDate.current = to === ApplicationStatus.INTERVIEW;
    startTransition(async () => {
      show(to);
      await changeStatus(id, to);
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Status: ${label}`}
            className="flex items-center gap-[9px] rounded-full border border-line-control bg-card px-3.5 py-[9px] text-sm font-medium hover:border-line-strong data-[state=open]:border-primary"
          >
            <StatusDot status={shown} />
            {label}
            <span aria-hidden="true" className="text-[10px] text-muted">
              ▼
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          onCloseAutoFocus={(event) => {
            if (!askForDate.current) return;
            askForDate.current = false;
            event.preventDefault();
            setInterview("ask");
          }}
        >
          <DropdownMenuLabel>Move this application to</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={shown} onValueChange={(value) => move(value as ApplicationStatus)}>
            {choices.map((entry) => (
              <DropdownMenuRadioItem key={entry.value} value={entry.value} disabled={scored && entry.value === ApplicationStatus.SENT && !hasUploadedResume}>
                <StatusDot status={entry.value} />
                {entry.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {shown === ApplicationStatus.INTERVIEW && (
        <InterviewDate
          id={id}
          at={interviewAt}
          timeZone={timeZone}
          open={interview !== null}
          asking={interview === "ask"}
          onOpenChange={(open) => setInterview(open ? "edit" : null)}
        />
      )}
      {(shown === ApplicationStatus.DRAFT || (scored && hasUploadedResume)) && <Button onClick={() => move(ApplicationStatus.SENT)}>Mark as sent</Button>}
    </>
  );
}
