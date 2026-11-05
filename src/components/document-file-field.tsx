"use client";

import { useId, useRef } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { FILE_ACCEPT, FILE_MAX_BYTES, FILE_MESSAGES } from "@/lib/application-files";

const KB = 1024;
/** "240 KB" or "1.2 MB". */
export const fileSize = (bytes: number) => (bytes < KB * KB ? `${Math.max(1, Math.round(bytes / KB))} KB` : `${(bytes / KB / KB).toFixed(1)} MB`);

/** Whether a chosen file can be uploaded; says why not when it can't. */
export function checkedFile(file: File | undefined): boolean {
  if (!file) return false;
  const problem = file.size > FILE_MAX_BYTES ? FILE_MESSAGES.tooBig : !/\.(pdf|docx)$/i.test(file.name) ? FILE_MESSAGES.wrongType : null;
  if (problem) toast(problem);
  return !problem;
}

/**
 * Picks a PDF or .docx for a resume or cover letter: the file's name once
 * chosen, with Change and Remove. Files over the limit are refused here,
 * before they're sent anywhere.
 */
export function DocumentFileField({
  label,
  file,
  onChange,
  busy = false,
}: {
  label: string;
  file: { name: string; size: number } | null;
  onChange: (file: File | null) => void;
  busy?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const choose = (chosen: File | undefined) => {
    if (input.current) input.current.value = "";
    if (checkedFile(chosen)) onChange(chosen!);
  };
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-[9px]">
      <span id={labelId} className="text-label text-muted">
        {label}
      </span>
      <input
        ref={input}
        type="file"
        accept={FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => choose(event.target.files?.[0])}
      />
      <div className="flex min-h-[42px] items-center justify-between gap-3 rounded-control border border-line-card bg-input py-1.5 pr-1.5 pl-3">
        <span className="min-w-0 truncate text-control">
          {file ? (
            <>
              {file.name} <span className="text-muted">· {fileSize(file.size)}</span>
            </>
          ) : (
            <span className="text-muted">PDF or Word (.docx), up to 5 MB</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {file && (
            <Button variant="text" size="sm" aria-disabled={busy || undefined} onClick={() => !busy && onChange(null)}>
              Remove<span className="sr-only">: {label}</span>
            </Button>
          )}
          <Button variant="secondary" size="sm" aria-disabled={busy || undefined} onClick={() => !busy && input.current?.click()}>
            {busy ? "Uploading…" : file ? "Change" : "Choose file"}
            <span className="sr-only">: {label}</span>
          </Button>
        </span>
      </div>
    </div>
  );
}
