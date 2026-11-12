"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ReviewQuestion } from "@/lib/easy-apply-answers";

export type ReviewedValues = Record<string, string | string[]>;

type Review = { questions: ReviewQuestion[]; resume: "written" | "uploaded" };

const filled = (value: string | string[] | undefined) => (Array.isArray(value) ? value.length > 0 : Boolean(value?.trim()));

/** The answers worth sending: filled ones, text trimmed. */
function answersOf(questions: ReviewQuestion[], values: ReviewedValues): ReviewedValues {
  const answers: ReviewedValues = {};
  for (const question of questions) {
    const value = values[question.id];
    if (!filled(value)) continue;
    answers[question.id] = Array.isArray(value) ? value : value!.trim();
  }
  return answers;
}

/**
 * "Confirm easy apply answers" (Settings → AI behaviour): what the agent
 * would send to Naukri's questions, and the resume that goes with it, to
 * change before anything is sent. Choices are radio buttons, several choices
 * checkboxes, text is held to Naukri's limit. Then send it with the agent, or
 * keep the answers on the draft and send later.
 */
export function AnswerReview({
  applicationId,
  review,
  onSend,
  onKeep,
}: {
  applicationId: string;
  review: Review;
  onSend: (answers: ReviewedValues) => Promise<void>;
  onKeep: (answers: ReviewedValues) => Promise<void>;
}) {
  const [values, setValues] = useState<ReviewedValues>(() => Object.fromEntries(review.questions.map((question) => [question.id, question.suggested])));
  const [busy, setBusy] = useState<"send" | "keep" | null>(null);
  const ready = review.questions.every((question) => !question.required || filled(values[question.id]));
  const set = (id: string, value: string | string[]) => setValues((current) => ({ ...current, [id]: value }));

  const run = async (kind: "send" | "keep", action: (answers: ReviewedValues) => Promise<void>) => {
    if (!ready || busy) return;
    setBusy(kind);
    try {
      await action(answersOf(review.questions, values));
    } finally {
      setBusy(null);
    }
  };

  return (
    <form
      aria-label="Check your answers"
      className="flex flex-col gap-4 rounded-card bg-track px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run("send", onSend);
      }}
    >
      <p role="note" className="text-meta">
        Nothing was sent yet. Check what Naukri will be told, and the resume that goes with it.
      </p>
      {review.questions.map((question) => (
        <Question key={question.id} question={question} value={values[question.id]} onChange={(value) => set(question.id, value)} />
      ))}
      <ResumePreview applicationId={applicationId} source={review.resume} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="sm" aria-disabled={!ready || busy !== null || undefined}>
          {busy === "send" ? "Sending…" : "Send with Naukri agent"}
        </Button>
        <Button type="button" variant="secondary" size="sm" aria-disabled={!ready || busy !== null || undefined} onClick={() => void run("keep", onKeep)}>
          {busy === "keep" ? "Saving…" : "Add to draft"}
        </Button>
        <Link href={`/applications/${applicationId}`} className="text-meta underline underline-offset-2">
          Open the application
        </Link>
      </div>
    </form>
  );
}

function Question({ question, value, onChange }: { question: ReviewQuestion; value: string | string[] | undefined; onChange: (value: string | string[]) => void }) {
  const label = `${question.text}${question.required ? "" : " (optional)"}`;

  if (question.type === "text") {
    const text = typeof value === "string" ? value : "";
    return (
      <Input
        label={label}
        value={text}
        maxLength={question.maxLength}
        hint={`${text.length}/${question.maxLength}`}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  const chosen = Array.isArray(value) ? value : [];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-1 text-sm">{label}</legend>
      {question.options.map((option) =>
        question.type === "choice" ? (
          <label key={option} className="flex w-fit cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="radio"
              name={question.id}
              value={option}
              checked={chosen[0] === option}
              onChange={() => onChange([option])}
              className="m-0 size-4 shrink-0 accent-primary"
            />
            {option}
          </label>
        ) : (
          <Checkbox
            key={option}
            label={option}
            checked={chosen.includes(option)}
            onChange={(event) => onChange(event.target.checked ? [...chosen, option] : chosen.filter((entry) => entry !== option))}
          />
        ),
      )}
    </fieldset>
  );
}

/** The resume that goes with the apply: the written one rendered to a PDF, or the user's own PDF. Loads when opened. */
function ResumePreview({ applicationId, source }: { applicationId: string; source: "written" | "uploaded" }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(source === "uploaded" ? `/api/applications/${applicationId}/files/resume` : null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open || url) return;
    let current = true;
    void fetch(`/api/pdf?doc=resume&application=${applicationId}`, { method: "POST" })
      .then(async (response) => {
        const body = (await response.json()) as { url?: string; error?: string };
        if (!current) return;
        if (response.ok && body.url) setUrl(`${body.url}?inline`);
        else setProblem(body.error ?? "The resume couldn't be shown.");
      })
      .catch(() => current && setProblem("The resume couldn't be shown."));
    return () => {
      current = false;
    };
  }, [open, url, applicationId]);

  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)} className="flex flex-col gap-2">
      <summary className="cursor-pointer text-sm">Resume that will be sent{source === "uploaded" ? " (the one you uploaded)" : ""}</summary>
      {problem ? (
        <p role="alert" className="pt-2 text-meta text-error">
          {problem}
        </p>
      ) : url ? (
        <iframe title="Resume that will be sent" src={url} className="mt-2 h-[min(720px,70vh)] w-full rounded-panel border border-line-card bg-card" />
      ) : (
        open && (
          <p role="status" className="pt-2 text-meta text-muted">
            Getting your resume…
          </p>
        )
      )}
    </details>
  );
}
