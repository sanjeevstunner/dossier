"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RemovableChip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SearchProblem } from "@/lib/job-search/search";
import {
  DESIRED_ROLES_MAX,
  differs,
  FIELDS,
  HEADLINE_MAX,
  KEY_SKILLS_MAX,
  LOCATIONS_MAX,
  NOTICE_PERIODS,
  noticeText,
  salaryText,
  SUMMARY_MAX,
  updateOf,
  type FieldKey,
  type NaukriEditable,
  type NaukriTag,
  type Suggestion,
} from "@/lib/naukri-profile";

import { NaukriLogin } from "../jobs/naukri-login";

import { lookUpNaukriTag, suggestNaukriProfile, updateNaukriProfile } from "./actions";

const DESCRIPTION =
  "Tailor your Naukri profile for the role you're after. Dossier suggests a headline, key skills, summary and roles from your profile, next to what Naukri shows now. Accept, edit or skip each one; nothing changes on Naukri until you update.";

const splitList = (text: string) => text.split(",").map((part) => part.trim()).filter(Boolean);

export function NaukriProfileScreen({ current, problem, aiReady }: { current: NaukriEditable | null; problem: SearchProblem | null; aiReady: boolean }) {
  const router = useRouter();
  return (
    <>
      <PageHeader title="Naukri profile" description={DESCRIPTION} />
      <div className="flex flex-col gap-6 px-10 pb-20">
        {current ? (
          <Tailor current={current} aiReady={aiReady} />
        ) : problem?.problem === "login" ? (
          <Card className="flex flex-col gap-3">
            <p className="text-meta">Dossier reads and updates your Naukri profile through NopeRi, which needs to be signed in to Naukri.</p>
            <NaukriLogin onLoggedIn={() => router.refresh()} />
          </Card>
        ) : (
          <p role="alert" className="rounded-card border border-line-card bg-card px-4 py-3 text-meta">
            {problem?.message ?? "Naukri isn't answering right now."}{" "}
            <Link href="/settings?section=jobs" className="underline underline-offset-2">
              Open Settings → Job search
            </Link>
          </p>
        )}
      </div>
    </>
  );
}

function Tailor({ current: initial, aiReady }: { current: NaukriEditable; aiReady: boolean }) {
  const [current, setCurrent] = useState(initial);
  const [role, setRole] = useState(initial.desiredRoles[0]?.name ?? "");
  const [locations, setLocations] = useState(initial.preferredLocations.map((tag) => tag.name).join(", "));
  const [salary, setSalary] = useState(initial.expectedSalary ? String(initial.expectedSalary.amount) : "");
  const [notice, setNotice] = useState(initial.noticePeriodId ? String(initial.noticePeriodId) : "");
  const [notes, setNotes] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [values, setValues] = useState<NaukriEditable | null>(null);
  const [accepted, setAccepted] = useState<Set<FieldKey>>(new Set());
  const [busy, setBusy] = useState<"suggest" | "update" | null>(null);
  const [confirming, setConfirming] = useState(false);

  const rows = suggestion ? FIELDS.filter(({ key }) => differs(key, current, suggestion)) : [];

  const suggest = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy("suggest");
    const result = toastResult(
      await suggestNaukriProfile({
        role,
        locations: splitList(locations).slice(0, LOCATIONS_MAX),
        salary: Number(salary) > 0 ? Math.round(Number(salary)) : null,
        noticePeriodId: notice ? Number(notice) : null,
        notes,
      }),
    );
    setBusy(null);
    if (!result.ok) return;
    setSuggestion(result.data);
    setValues(result.data);
    setAccepted(new Set());
    if (result.data.unresolved.length) toast(`Naukri didn't recognise: ${result.data.unresolved.join(", ")}.`);
  };

  const edit = <K extends FieldKey>(key: K, value: NaukriEditable[K]) => {
    setValues((now) => now && { ...now, [key]: value });
    setAccepted((now) => new Set(now).add(key));
  };
  const toggle = (key: FieldKey, on: boolean) =>
    setAccepted((now) => {
      const next = new Set(now);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const update = async () => {
    if (!values || busy) return;
    setBusy("update");
    const result = toastResult(await updateNaukriProfile(updateOf(values, [...accepted])));
    setBusy(null);
    if (!result.ok) return;
    setCurrent(result.data);
    setSuggestion(null);
    setValues(null);
    setAccepted(new Set());
  };

  return (
    <>
      <Card padding="none" className="p-6">
        <form aria-label="Target role" onSubmit={suggest} className="grid gap-4 md:grid-cols-2">
          <Input label="Role you're after" value={role} required maxLength={150} onChange={(event) => setRole(event.target.value)} placeholder="e.g. Forward Deployed Engineer" />
          <Input
            label="Preferred locations"
            hint={`Comma-separated, up to ${LOCATIONS_MAX}`}
            value={locations}
            onChange={(event) => setLocations(event.target.value)}
            placeholder="Bengaluru, Pune, Hyderabad"
          />
          <Input
            label="Expected salary (per year)"
            hint={current.expectedSalary ? `Now ${salaryText(current.expectedSalary)}` : undefined}
            type="number"
            min={1}
            inputMode="numeric"
            value={salary}
            onChange={(event) => setSalary(event.target.value)}
            placeholder="1800000"
          />
          <Select label="Notice period" value={notice} onChange={(event) => setNotice(event.target.value)}>
            <option value="">Keep as it is</option>
            {NOTICE_PERIODS.map((period) => (
              <option key={period.id} value={period.id}>
                {period.label}
              </option>
            ))}
          </Select>
          <Textarea
            label="Anything to bring out (optional)"
            className="md:col-span-2"
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="e.g. Lead with AWS and agentic AI work; open to client-facing roles."
          />
          <div className="flex items-center gap-3 md:col-span-2">
            <Button type="submit" aria-disabled={!aiReady || busy !== null || undefined}>
              {busy === "suggest" ? "Suggesting…" : suggestion ? "Suggest again" : "Suggest changes"}
            </Button>
            {!aiReady && (
              <p className="text-meta text-muted">
                Choose an AI provider in{" "}
                <Link href="/settings?section=ai" className="underline underline-offset-2">
                  Settings
                </Link>{" "}
                first.
              </p>
            )}
          </div>
        </form>
      </Card>

      {suggestion && values && (
        <section aria-label="Suggested changes" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-section">
              {rows.length ? `${rows.length} suggested ${rows.length === 1 ? "change" : "changes"}` : "Nothing to change"}
            </h2>
            {rows.length > 0 && (
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setAccepted(new Set(rows.map((row) => row.key)))}>
                  Accept all
                </Button>
                <Button size="sm" aria-disabled={accepted.size === 0 || busy !== null || undefined} onClick={() => accepted.size > 0 && !busy && setConfirming(true)}>
                  {busy === "update" ? "Updating…" : `Update Naukri profile${accepted.size ? ` (${accepted.size})` : ""}`}
                </Button>
              </div>
            )}
          </div>
          {rows.map(({ key, label }) => (
            <Card key={key} role="group" aria-label={label} padding="none" className="flex flex-col gap-3 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">{label}</h3>
                <Checkbox label="Accept" checked={accepted.has(key)} onChange={(event) => toggle(key, event.target.checked)} />
              </div>
              {suggestion.reasons[key] && <p className="text-meta text-muted">{suggestion.reasons[key]}</p>}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <p className="text-label text-muted">Now on Naukri</p>
                  <div className="text-sm whitespace-pre-line">{show(key, current)}</div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="text-label text-muted">Suggested (edit as you like)</p>
                  <Editor field={key} values={values} onChange={edit} />
                </div>
              </div>
            </Card>
          ))}
        </section>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Update your Naukri profile?"
        description={`These change on Naukri now: ${FIELDS.filter(({ key }) => accepted.has(key)).map(({ label }) => label.toLowerCase()).join(", ")}. Recruiters see them right away.`}
        confirmLabel="Update Naukri profile"
        onConfirm={() => void update()}
      />
    </>
  );
}

/** A field's value as text, for the "Now on Naukri" side. */
function show(key: FieldKey, profile: NaukriEditable): ReactNode {
  switch (key) {
    case "keySkills":
      return profile.keySkills.join(", ") || "None";
    case "desiredRoles":
    case "preferredLocations":
      return profile[key].map((tag) => tag.name).join(", ") || "None";
    case "expectedSalary":
      return salaryText(profile.expectedSalary);
    case "noticePeriodId":
      return noticeText(profile.noticePeriodId);
    default:
      return profile[key] || "Empty";
  }
}

function Editor({ field, values, onChange }: { field: FieldKey; values: NaukriEditable; onChange: <K extends FieldKey>(key: K, value: NaukriEditable[K]) => void }) {
  switch (field) {
    case "headline":
      return (
        <Input aria-label="Suggested headline" value={values.headline} maxLength={HEADLINE_MAX} hint={`${values.headline.length}/${HEADLINE_MAX}`} onChange={(event) => onChange("headline", event.target.value)} />
      );
    case "summary":
      return (
        <Textarea aria-label="Suggested summary" rows={8} value={values.summary} maxLength={SUMMARY_MAX} hint={`${values.summary.length}/${SUMMARY_MAX}`} onChange={(event) => onChange("summary", event.target.value)} />
      );
    case "keySkills":
      return (
        <Chips
          label="key skill"
          names={values.keySkills}
          max={KEY_SKILLS_MAX}
          onChange={(names) => onChange("keySkills", names)}
          add={async (name) => name}
        />
      );
    case "desiredRoles":
    case "preferredLocations": {
      const tags = values[field];
      const type = field === "desiredRoles" ? "designation" : "location";
      return (
        <Chips
          label={field === "desiredRoles" ? "role" : "location"}
          names={tags.map((tag) => tag.name)}
          max={field === "desiredRoles" ? DESIRED_ROLES_MAX : LOCATIONS_MAX}
          onChange={(names) => onChange(field, tags.filter((tag) => names.includes(tag.name)))}
          add={async (name) => {
            const result = toastResult(await lookUpNaukriTag({ type, name }));
            if (!result.ok || tags.some((tag) => tag.id === result.data.id)) return null;
            onChange(field, [...tags, result.data] as NaukriTag[]);
            return null;
          }}
        />
      );
    }
    case "expectedSalary":
      return (
        <Input
          aria-label="Suggested expected salary"
          type="number"
          min={1}
          value={values.expectedSalary?.amount ?? ""}
          hint={salaryText(values.expectedSalary)}
          onChange={(event) => {
            const amount = Math.round(Number(event.target.value));
            onChange("expectedSalary", amount > 0 ? { amount, currency: values.expectedSalary?.currency ?? "INR" } : null);
          }}
        />
      );
    case "noticePeriodId":
      return (
        <Select aria-label="Suggested notice period" value={values.noticePeriodId ?? ""} onChange={(event) => onChange("noticePeriodId", Number(event.target.value) || null)}>
          {NOTICE_PERIODS.map((period) => (
            <option key={period.id} value={period.id}>
              {period.label}
            </option>
          ))}
        </Select>
      );
  }
}

/**
 * Removable chips with a box to add one. `add` answers the name to add, or
 * null when it handled the change itself (or refused it).
 */
function Chips({ label, names, max, onChange, add }: { label: string; names: string[]; max: number; onChange: (names: string[]) => void; add: (name: string) => Promise<string | null> }) {
  const [typed, setTyped] = useState("");
  const [adding, setAdding] = useState(false);
  const submit = async () => {
    const name = typed.trim();
    if (!name || adding || names.length >= max) return;
    if (names.some((existing) => existing.toLowerCase() === name.toLowerCase())) return setTyped("");
    setAdding(true);
    const added = await add(name);
    setAdding(false);
    if (added) onChange([...names, added]);
    setTyped("");
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {names.map((name) => (
          <RemovableChip key={name} removeLabel={`Remove ${name}`} onRemove={() => onChange(names.filter((other) => other !== name))}>
            {name}
          </RemovableChip>
        ))}
      </div>
      {names.length < max && (
        <Input
          aria-label={`Add a ${label}`}
          placeholder={adding ? "Looking it up…" : `Add a ${label} and press Enter`}
          value={typed}
          disabled={adding}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void submit();
          }}
        />
      )}
    </div>
  );
}
