"use client";

import { DocumentFileField } from "@/components/document-file-field";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApplicationStatus } from "@/generated/prisma/enums";
import type { EmailParts } from "@/lib/application-email";
import { STATUSES } from "@/lib/status";

/** Where an application added by hand stands, and when it was sent. */
export type Tracking = {
  status: ApplicationStatus;
  /** YYYY-MM-DD, or empty while it's a Draft. */
  appliedOn: string;
};

/** The user's own resume and cover letter, chosen but not uploaded yet. */
export type OwnFiles = { resume: File | null; letter: File | null };

/** Whether a status says it was sent, so it has a date it was sent on. */
export const hasAppliedDate = (status: ApplicationStatus) => status !== ApplicationStatus.DRAFT && status !== ApplicationStatus.DECLINED;

/** Today, as the date input wants it, in the browser's time zone. */
export const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

/**
 * "Your documents": what the application was sent with when the AI doesn't
 * write it. The resume and cover letter as files, the email, and how far
 * it has got. Everything is optional.
 */
export function ManualCard({
  files,
  onFiles,
  email,
  onEmail,
  tracking,
  onTracking,
}: {
  files: OwnFiles;
  onFiles: (files: OwnFiles) => void;
  email: EmailParts;
  onEmail: (email: EmailParts) => void;
  tracking: Tracking;
  onTracking: (tracking: Tracking) => void;
}) {
  const setStatus = (status: ApplicationStatus) =>
    onTracking({ status, appliedOn: hasAppliedDate(status) ? tracking.appliedOn || today() : "" });
  return (
    <>
      <Card className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 tabIndex={-1} className="text-[15px] font-medium">
            Your documents
          </h2>
          <p className="text-meta text-muted">
            The resume and cover letter you sent, kept as they are. Skip them if you like: you can add them, or have the AI write them,
            from the application later. Choose them again if you reload this page.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-x-[18px] gap-y-5 sm:grid-cols-2">
          <DocumentFileField label="Resume" file={files.resume} onChange={(resume) => onFiles({ ...files, resume })} />
          <DocumentFileField label="Cover letter" file={files.letter} onChange={(letter) => onFiles({ ...files, letter })} />
        </div>
      </Card>

      <Card className="flex flex-col gap-5">
        <h2 className="text-[15px] font-medium">The email you sent</h2>
        <div className="grid grid-cols-1 gap-x-[18px] gap-y-5 sm:grid-cols-2">
          <Input label="To" placeholder="jobs@example.com" value={email.to} onChange={(event) => onEmail({ ...email, to: event.target.value })} />
          <Input label="Subject" value={email.subject} onChange={(event) => onEmail({ ...email, subject: event.target.value })} />
        </div>
        <Textarea label="Message" rows={6} value={email.body} onChange={(event) => onEmail({ ...email, body: event.target.value })} />
      </Card>

      <Card className="grid grid-cols-1 gap-x-[18px] gap-y-5 sm:grid-cols-2">
        <h2 className="text-[15px] font-medium sm:col-span-2">Where it stands</h2>
        <Select label="Status" value={tracking.status} onChange={(event) => setStatus(event.target.value as ApplicationStatus)}>
          {STATUSES.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </Select>
        {hasAppliedDate(tracking.status) && (
          <Input
            label="Applied on"
            type="date"
            max={today()}
            required
            value={tracking.appliedOn}
            onChange={(event) => onTracking({ ...tracking, appliedOn: event.target.value })}
          />
        )}
      </Card>
    </>
  );
}
