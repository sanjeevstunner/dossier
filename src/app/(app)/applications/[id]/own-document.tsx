"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { checkedFile, DocumentFileField, fileSize } from "@/components/document-file-field";
import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { FILE_ACCEPT, fileHref, PDF_TYPE, uploadFile, type FileInfo, type FileKind } from "@/lib/application-files";

const WHAT: Record<FileKind, string> = { resume: "resume", letter: "cover letter" };

/**
 * The Resume or Cover letter tab before the AI has written one: the file the
 * user uploaded, shown as it is (a PDF in place, a .docx to download), or a
 * form to upload one. Either way the AI can write it: tailored from the
 * upload, or from the profile.
 */
export function OwnDocument({
  applicationId,
  kind,
  file,
  hasPosting,
  writing,
  onWrite,
  onAddPosting,
}: {
  applicationId: string;
  kind: FileKind;
  /** The uploaded file; null when there's none. */
  file: FileInfo | null;
  /** Whether the application has a posting to tailor to. */
  hasPosting: boolean;
  /** The AI is writing it. */
  writing: boolean;
  /** "Generate with AI", or "Tailor with AI" from the upload. */
  onWrite: (fromUpload: boolean) => void;
  /** Takes the user to the Job posting tab. */
  onAddPosting: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const what = WHAT[kind];

  const upload = async (chosen: File | null) => {
    setBusy(true);
    const result = chosen
      ? await uploadFile(applicationId, kind, chosen)
      : await fetch(fileHref(applicationId, kind), { method: "DELETE" })
          .then((response) => (response.ok ? { ok: true as const } : { ok: false as const, error: `That didn't remove the ${what}. Try again.` }))
          .catch(() => ({ ok: false as const, error: `That didn't remove the ${what}. Check your connection and try again.` }));
    setBusy(false);
    if (!result.ok) return toast(result.error);
    toast(chosen ? `Added your ${what}.` : `Removed your ${what}.`);
    startTransition(() => router.refresh());
  };

  const aiButtons = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {file && (
          <Button aria-disabled={writing || !hasPosting || undefined} onClick={() => !writing && hasPosting && onWrite(true)}>
            {writing ? "Tailoring…" : "Tailor with AI"}
          </Button>
        )}
        <Button
          variant={file ? "secondary" : "primary"}
          aria-disabled={writing || !hasPosting || undefined}
          onClick={() => !writing && hasPosting && onWrite(false)}
        >
          {writing && !file ? "Writing…" : file ? "Write a new one with AI" : "Generate with AI"}
        </Button>
      </div>
      {hasPosting ? (
        <p className="text-meta text-muted">
          {file
            ? `Tailor with AI keeps what your ${what} says and fits it to the posting; the new one is written from your profile. Your file stays as it is.`
            : `Written from your profile for this posting, like the ${what}s Dossier writes for new applications.`}
        </p>
      ) : (
        <p className="text-meta text-muted">
          The AI needs the job posting to tailor it to.{" "}
          <Button variant="text" size="sm" className="p-0! underline underline-offset-2" onClick={onAddPosting}>
            Add the job posting
          </Button>
        </p>
      )}
    </div>
  );

  if (!file) {
    return (
      <div className="flex flex-1 flex-col items-center overflow-auto bg-canvas px-10 pt-11 pb-16">
        <div className="flex w-full max-w-[560px] flex-col gap-5 rounded-panel border border-line-card bg-card px-7 py-7">
          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-section">No {what} yet</h2>
            <p className="text-sm text-muted">Upload the {what} you sent with this application, or have the AI write one.</p>
          </div>
          <DocumentFileField label={`Your ${what}`} file={null} busy={busy} onChange={(chosen) => void upload(chosen)} />
          {aiButtons}
        </div>
      </div>
    );
  }

  const pdf = file.type === PDF_TYPE;
  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-auto bg-canvas px-10 pt-11 pb-16">
      <div className="flex w-full max-w-[816px] flex-wrap items-center justify-between gap-x-3 gap-y-2 text-meta text-muted">
        <span className="min-w-0 truncate">
          Your {what} · {file.name} · {fileSize(file.size)}
        </span>
        <span className="flex items-center gap-1">
          <ReplaceButton busy={busy} what={what} onChoose={(chosen) => void upload(chosen)} />
          <Button variant="text" size="sm" aria-disabled={busy || undefined} onClick={() => !busy && void upload(null)}>
            Remove
          </Button>
        </span>
      </div>
      {pdf ? (
        <iframe
          title={`Your ${what}`}
          src={fileHref(applicationId, kind)}
          className="h-[min(1056px,80vh)] w-full max-w-[816px] rounded-panel border border-line-card bg-card"
        />
      ) : (
        <div className="flex w-full max-w-[816px] flex-col gap-2 rounded-panel border border-line-card bg-card px-7 py-6">
          <p className="text-sm">Word files can&apos;t be shown here. Download it to read it.</p>
        </div>
      )}
      <div className="w-full max-w-[816px]">{aiButtons}</div>
    </div>
  );
}

/** "Replace": picks another file for the same document. */
function ReplaceButton({ busy, what, onChoose }: { busy: boolean; what: string; onChoose: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = "";
          if (checkedFile(chosen)) onChoose(chosen!);
        }}
      />
      <Button variant="text" size="sm" aria-disabled={busy || undefined} onClick={() => !busy && input.current?.click()}>
        {busy ? "Uploading…" : "Replace"} <span className="sr-only">your {what}</span>
      </Button>
    </>
  );
}
