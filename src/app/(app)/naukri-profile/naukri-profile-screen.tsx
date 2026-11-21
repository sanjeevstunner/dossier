"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

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
  BASICS_FIELDS,
  DESIRED_ROLES_MAX,
  FIELDS,
  HEADLINE_MAX,
  isNew,
  itemKey,
  itemProblem,
  KEY_SKILLS_CHARS,
  KEY_SKILLS_MAX,
  LOCATIONS_MAX,
  MARITAL_STATUSES,
  NOTICE_PERIODS,
  noticeText,
  PERSONAL_FIELDS,
  salaryText,
  same,
  SECTION_NAMES,
  SECTIONS,
  SUMMARY_MAX,
  updateOf,
  type FieldKey,
  type FieldSpec,
  type LookupType,
  type NaukriEditable,
  type NaukriOption,
  type NaukriTag,
  type OptionList,
  type SectionItem,
  type SectionName,
  type Suggestion,
} from "@/lib/naukri-profile";

import { NaukriLogin } from "../jobs/naukri-login";

import { lookUpNaukriTag, naukriDropdown, suggestNaukriProfile, updateNaukriProfile } from "./actions";

const DESCRIPTION =
  "Your whole Naukri profile, to tailor for the role you're after. Dossier suggests changes to every section from your profile, next to what Naukri shows now; you can also edit, add or delete anything yourself. Nothing changes on Naukri until you update.";

const splitList = (text: string) => text.split(",").map((part) => part.trim()).filter(Boolean);
type Loose = Record<string, unknown>;

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

/** The keys of everything that differs from Naukri now: single fields, then changed or new items. */
function changedKeys(current: NaukriEditable, values: NaukriEditable): string[] {
  const fields = FIELDS.filter(({ key }) => !same(current[key], values[key])).map(({ key }) => key as string);
  const items = SECTION_NAMES.flatMap((name) =>
    (values[name] as SectionItem[])
      .filter((item) => {
        const before = (current[name] as SectionItem[]).find((kept) => kept.id === item.id);
        return !before || !same(before, item);
      })
      .map((item) => itemKey(name, item)),
  );
  return [...fields, ...items];
}

/** The problem stopping a change from being sent, or null. */
function problemOf(key: string, values: NaukriEditable): string | null {
  if (key === "basics") return itemProblem(BASICS_FIELDS, values.basics);
  if (key === "personal") return itemProblem(PERSONAL_FIELDS, values.personal);
  const [name] = key.split(":") as [SectionName];
  if (!(name in SECTIONS)) return null;
  const item = (values[name] as SectionItem[]).find((entry) => itemKey(name, entry) === key);
  return item ? itemProblem(SECTIONS[name].fields, item as Loose) : null;
}

const toggled = (set: ReadonlySet<string>, key: string, on: boolean) => {
  const next = new Set(set);
  if (on) next.add(key);
  else next.delete(key);
  return next;
};

function Tailor({ current: initial, aiReady }: { current: NaukriEditable; aiReady: boolean }) {
  const [current, setCurrent] = useState(initial);
  const [values, setValues] = useState(initial);
  const [reasons, setReasons] = useState<Suggestion["reasons"]>({});
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<"suggest" | "update" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [role, setRole] = useState(initial.desiredRoles[0]?.name ?? "");
  const [locations, setLocations] = useState(initial.preferredLocations.map((tag) => tag.name).join(", "));
  const [salary, setSalary] = useState(initial.expectedSalary ? String(initial.expectedSalary.amount) : "");
  const [notice, setNotice] = useState(initial.noticePeriodId ? String(initial.noticePeriodId) : "");
  const [notes, setNotes] = useState("");

  const changed = changedKeys(current, values);
  const sending = changed.filter((key) => accepted.has(key) && !problemOf(key, values));
  const count = sending.length + removed.size;
  const accept = (key: string, on = true) => setAccepted((now) => toggled(now, key, on));
  const set = (key: keyof NaukriEditable, value: unknown, accepting: string) => {
    setValues((now) => ({ ...now, [key]: value }));
    accept(accepting);
  };

  const suggest = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !aiReady) return;
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
    const { reasons: why, unresolved, ...suggested } = result.data;
    setValues(suggested);
    setReasons(why);
    setAccepted(new Set());
    if (unresolved.length) toast(`Naukri didn't recognise: ${unresolved.join(", ")}.`);
  };

  const update = async () => {
    if (busy) return;
    setBusy("update");
    const result = toastResult(await updateNaukriProfile(updateOf(values, new Set(sending), removed)));
    setBusy(null);
    if (!result.ok) return;
    setCurrent(result.data);
    setValues(result.data);
    setReasons({});
    setAccepted(new Set());
    setRemoved(new Set());
  };

  return (
    <>
      <Card padding="none" className="p-6">
        <form aria-label="Target role" onSubmit={suggest} className="grid gap-4 md:grid-cols-2">
          <Input label="Role you're after" value={role} required maxLength={150} onChange={(event) => setRole(event.target.value)} placeholder="e.g. Forward Deployed Engineer" />
          <Input label="Preferred locations" hint={`Comma-separated, up to ${LOCATIONS_MAX}`} value={locations} onChange={(event) => setLocations(event.target.value)} placeholder="Bengaluru, Pune" />
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
              {busy === "suggest" ? "Suggesting… (this takes a minute)" : "Suggest changes"}
            </Button>
            {!aiReady && (
              <p className="text-meta text-muted">
                Choose an AI provider in{" "}
                <Link href="/settings?section=ai" className="underline underline-offset-2">
                  Settings
                </Link>{" "}
                first. You can still edit everything below yourself.
              </p>
            )}
          </div>
        </form>
      </Card>

      <section aria-label="Changes" className="sticky top-16 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line-card bg-card px-4 py-3">
        <p className="text-sm">
          {changed.length + removed.size === 0
            ? "No changes yet. Suggest changes, or edit any section below."
            : `${changed.length + removed.size} ${changed.length + removed.size === 1 ? "change" : "changes"}, ${count} to send`}
        </p>
        <div className="flex items-center gap-2">
          {changed.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setAccepted(new Set(changed.filter((key) => !problemOf(key, values))))}>
              Accept all
            </Button>
          )}
          <Button size="sm" aria-disabled={count === 0 || busy !== null || undefined} onClick={() => count > 0 && !busy && setConfirming(true)}>
            {busy === "update" ? "Updating…" : `Update Naukri profile${count ? ` (${count})` : ""}`}
          </Button>
        </div>
      </section>

      <section aria-label="Profile" className="flex flex-col gap-4">
        {FIELDS.map(({ key, label }) => {
          const isChanged = changed.includes(key);
          return (
            <Card key={key} role="group" aria-label={label} padding="none" className="flex flex-col gap-3 p-5">
              <RowHeader title={label} changed={isChanged} accepted={accepted.has(key)} problem={isChanged ? problemOf(key, values) : null} onAccept={(on) => accept(key, on)} />
              {reasons[key] && isChanged && <p className="text-meta text-muted">{reasons[key]}</p>}
              <Expandable open={isChanged} now={show(key, current)}>
                <div className="grid gap-4 md:grid-cols-2">
                  <Side title="Now on Naukri">
                    <div className="text-sm whitespace-pre-line">{show(key, current)}</div>
                  </Side>
                  <Side title={isChanged ? "Suggested (edit as you like)" : "Edit"}>
                    <FieldEditor field={key} values={values} onChange={(value) => set(key, value, key)} />
                  </Side>
                </div>
              </Expandable>
            </Card>
          );
        })}
      </section>

      {SECTION_NAMES.map((name) => (
        <SectionCard
          key={name}
          name={name}
          current={current[name] as SectionItem[]}
          items={values[name] as SectionItem[]}
          reason={reasons[name]}
          accepted={accepted}
          removed={removed}
          changed={changed}
          onAccept={accept}
          onChange={(items, key) => set(name, items, key)}
          onRemove={(key, on) => setRemoved((now) => toggled(now, key, on))}
        />
      ))}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Update your Naukri profile?"
        description={`${sending.length} ${sending.length === 1 ? "change is" : "changes are"} saved${removed.size ? ` and ${removed.size} ${removed.size === 1 ? "item is" : "items are"} deleted` : ""} on Naukri now. Recruiters see them right away.`}
        confirmLabel="Update Naukri profile"
        onConfirm={() => void update()}
      />
    </>
  );
}

function RowHeader({ title, changed, accepted, problem, onAccept, children }: { title: ReactNode; changed: boolean; accepted: boolean; problem: string | null; onAccept: (on: boolean) => void; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="font-semibold">{title}</h3>
      <div className="flex flex-wrap items-center gap-3">
        {children}
        {changed && (problem ? <p className="text-meta text-error">{problem}</p> : <Checkbox label="Accept" checked={accepted} onChange={(event) => onAccept(event.target.checked)} />)}
      </div>
    </div>
  );
}

function Side({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-label text-muted">{title}</p>
      {children}
    </div>
  );
}

/** The editor when open (changed, or opened by hand), else what's on Naukri now with an Edit button. */
function Expandable({ open, now, children }: { open: boolean; now: ReactNode; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  if (open || opened) return <>{children}</>;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 text-sm whitespace-pre-line text-muted">{now}</div>
      <Button variant="text" size="sm" onClick={() => setOpened(true)}>
        Edit
      </Button>
    </div>
  );
}

/** A single field's value as text. */
function show(key: FieldKey, profile: NaukriEditable): string {
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
    case "basics": {
      const { name, city, experience, currentSalary } = profile.basics;
      return [name, city?.name, `${experience.years} years ${experience.months} months`, currentSalary && `Current salary ${salaryText(currentSalary)}`].filter(Boolean).join(" · ");
    }
    case "personal": {
      const { birthDate, gender, maritalStatus, address, hometown, pincode } = profile.personal;
      return [birthDate && `Born ${birthDate}`, gender === "M" ? "Male" : gender === "F" ? "Female" : "", MARITAL_STATUSES.find((status) => status.value === maritalStatus)?.label, address, hometown, pincode].filter(Boolean).join(" · ") || "Empty";
    }
    case "headline":
    case "summary":
      return profile[key] || "Empty";
  }
}

function FieldEditor({ field, values, onChange }: { field: FieldKey; values: NaukriEditable; onChange: (value: unknown) => void }) {
  switch (field) {
    case "headline":
      return <Input aria-label="Suggested headline" value={values.headline} maxLength={HEADLINE_MAX} hint={`${values.headline.length}/${HEADLINE_MAX}`} onChange={(event) => onChange(event.target.value)} />;
    case "summary":
      return <Textarea aria-label="Suggested summary" rows={8} value={values.summary} maxLength={SUMMARY_MAX} hint={`${values.summary.length}/${SUMMARY_MAX}`} onChange={(event) => onChange(event.target.value)} />;
    case "keySkills": {
      const used = values.keySkills.join(",").length;
      const add = async (name: string) => {
        if ([...values.keySkills, name].join(",").length <= KEY_SKILLS_CHARS) return name;
        toast(`Naukri allows ${KEY_SKILLS_CHARS} characters of key skills in all. Remove one to add "${name}".`);
        return null;
      };
      return (
        <div className="flex flex-col gap-1">
          <Chips label="key skill" names={values.keySkills} max={KEY_SKILLS_MAX} onChange={onChange} add={add} />
          <p className={used > KEY_SKILLS_CHARS ? "text-destructive text-sm" : "text-muted-foreground text-sm"}>
            {used}/{KEY_SKILLS_CHARS} characters
          </p>
        </div>
      );
    }
    case "desiredRoles":
    case "preferredLocations": {
      const tags = values[field];
      return (
        <Chips
          label={field === "desiredRoles" ? "role" : "location"}
          names={tags.map((tag) => tag.name)}
          max={field === "desiredRoles" ? DESIRED_ROLES_MAX : LOCATIONS_MAX}
          onChange={(names) => onChange(tags.filter((tag) => names.includes(tag.name)))}
          add={async (name) => {
            const found = await lookUp(field === "desiredRoles" ? "designation" : "location", name);
            if (found && !tags.some((tag) => tag.id === found.id)) onChange([...tags, found]);
            return null;
          }}
        />
      );
    }
    case "expectedSalary":
      return <SalaryInput label="Suggested expected salary" salary={values.expectedSalary} onChange={onChange} />;
    case "noticePeriodId":
      return (
        <Select aria-label="Suggested notice period" value={values.noticePeriodId ?? ""} onChange={(event) => onChange(Number(event.target.value) || null)}>
          {NOTICE_PERIODS.map((period) => (
            <option key={period.id} value={period.id}>
              {period.label}
            </option>
          ))}
        </Select>
      );
    case "basics":
      return (
        <div className="flex flex-col gap-3">
          <Fields fields={BASICS_FIELDS} item={values.basics} onChange={onChange} />
          <SalaryInput label="Current salary (per year)" salary={values.basics.currentSalary} onChange={(currentSalary) => onChange({ ...values.basics, currentSalary })} />
        </div>
      );
    case "personal":
      return <Fields fields={PERSONAL_FIELDS} item={values.personal} onChange={onChange} />;
  }
}

function SalaryInput({ label, salary, onChange }: { label: string; salary: { amount: number; currency: string } | null; onChange: (salary: { amount: number; currency: string } | null) => void }) {
  return (
    <Input
      label={label}
      type="number"
      min={1}
      value={salary?.amount ?? ""}
      hint={salaryText(salary)}
      onChange={(event) => {
        const amount = Math.round(Number(event.target.value));
        onChange(amount > 0 ? { amount, currency: salary?.currency ?? "INR" } : null);
      }}
    />
  );
}

function SectionCard({
  name,
  current,
  items,
  reason,
  accepted,
  removed,
  changed,
  onAccept,
  onChange,
  onRemove,
}: {
  name: SectionName;
  current: SectionItem[];
  items: SectionItem[];
  reason?: string;
  accepted: ReadonlySet<string>;
  removed: ReadonlySet<string>;
  changed: string[];
  onAccept: (key: string, on: boolean) => void;
  onChange: (items: SectionItem[], key: string) => void;
  onRemove: (key: string, on: boolean) => void;
}) {
  const section = SECTIONS[name];
  const [added, setAdded] = useState(0);
  const line = section.line as (item: SectionItem) => string;
  return (
    <Card role="group" aria-label={section.label} padding="none" className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-section">{section.label}</h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const item = { ...section.blank(), id: `new-manual-${added + 1}` } as SectionItem;
            setAdded(added + 1);
            onChange([...items, item], itemKey(name, item));
          }}
        >
          Add {section.noun}
        </Button>
      </div>
      {reason && <p className="text-meta text-muted">{reason}</p>}
      {items.length === 0 && <p className="text-meta text-muted">None on Naukri.</p>}
      {items.map((item) => {
        const key = itemKey(name, item);
        const before = current.find((kept) => kept.id === item.id);
        const isChanged = changed.includes(key);
        const isRemoved = removed.has(key);
        const status = isRemoved ? "will be deleted" : isNew(item) ? "new" : isChanged ? "changed" : null;
        const title = line(item).replace(/^[\s·:,]+|[\s·:,]+$/g, "") || `New ${section.noun}`;
        return (
          <div key={key} role="group" aria-label={title} className="flex flex-col gap-3 rounded-card border border-line-card px-4 py-3">
            <RowHeader
              title={
                <span className={isRemoved ? "line-through" : undefined}>
                  {title}
                  {status && <span className="ml-2 text-meta font-normal text-muted">({status})</span>}
                </span>
              }
              changed={isChanged && !isRemoved}
              accepted={accepted.has(key)}
              problem={isChanged && !isRemoved ? itemProblem(section.fields, item as Loose) : null}
              onAccept={(on) => onAccept(key, on)}
            >
              <Button
                variant={isRemoved ? "text" : "danger-text"}
                size="sm"
                onClick={() => (isNew(item) ? onChange(items.filter((other) => other !== item), key) : onRemove(key, !isRemoved))}
              >
                {isRemoved ? "Keep" : isNew(item) ? "Discard" : "Delete"}
              </Button>
            </RowHeader>
            {!isRemoved && (
              <Expandable open={isChanged} now={null}>
                {before && isChanged && <p className="text-meta text-muted">Now on Naukri: {line(before)}</p>}
                <Fields fields={section.fields} item={item as Loose} onChange={(next) => onChange(items.map((other) => (other === item ? (next as SectionItem) : other)), key)} />
              </Expandable>
            )}
          </div>
        );
      })}
    </Card>
  );
}

/** Inputs for an item's fields, by their specs. */
function Fields<T extends object>({ fields, item, onChange }: { fields: FieldSpec[]; item: T; onChange: (item: T) => void }) {
  const values = item as Loose;
  const put = (key: string, value: unknown) => onChange({ ...item, [key]: value });
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {fields.map((field) => {
        const value = values[field.key];
        switch (field.kind) {
          case "textarea":
            return <Textarea key={field.key} className="md:col-span-2" label={field.label} rows={4} maxLength={field.max} value={String(value ?? "")} onChange={(event) => put(field.key, event.target.value)} />;
          case "skills":
            return <Input key={field.key} className="md:col-span-2" label={`${field.label} (comma-separated)`} value={((value as string[]) ?? []).join(", ")} onChange={(event) => put(field.key, splitList(event.target.value))} />;
          case "check":
            return <Checkbox key={field.key} label={field.label} checked={Boolean(value)} onChange={(event) => put(field.key, event.target.checked)} />;
          case "month":
            return <Input key={field.key} label={field.label} type="month" value={String(value ?? "")} onChange={(event) => put(field.key, event.target.value || null)} />;
          case "year":
            return (
              <Input
                key={field.key}
                label={field.label}
                type="number"
                min={1950}
                max={2100}
                value={value === null || value === undefined ? "" : String(value)}
                onChange={(event) => put(field.key, event.target.value ? Number(event.target.value) : null)}
              />
            );
          case "duration": {
            const time = (value as { years: number; months: number } | undefined) ?? { years: 0, months: 0 };
            return (
              <div key={field.key} className="grid grid-cols-2 gap-2">
                <Input label={`${field.label}: years`} type="number" min={0} max={50} value={time.years} onChange={(event) => put(field.key, { ...time, years: Math.max(0, Math.round(Number(event.target.value))) })} />
                <Input label="Months" type="number" min={0} max={11} value={time.months} onChange={(event) => put(field.key, { ...time, months: Math.max(0, Math.min(11, Math.round(Number(event.target.value)))) })} />
              </div>
            );
          }
          case "choice":
            return (
              <Select
                key={field.key}
                label={field.label}
                value={value === null || value === undefined ? "" : String(value)}
                onChange={(event) => put(field.key, field.choices.find((option) => String(option.value) === event.target.value)?.value ?? null)}
              >
                {field.optional && <option value="">Not set</option>}
                {field.choices.map((choice) => (
                  <option key={String(choice.value)} value={String(choice.value)}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            );
          case "option":
            return (
              <OptionSelect
                key={field.key}
                label={field.label}
                list={field.list(values)}
                parent={field.parent ? (values[field.parent] as NaukriTag | null)?.id : undefined}
                optional={field.optional}
                value={value as NaukriTag | null}
                onChange={(tag) => put(field.key, tag)}
              />
            );
          case "ref":
            return <RefInput key={field.key} label={field.label} type={field.lookup} value={value as { id: string | number | null; name: string } | null} onChange={(ref) => put(field.key, ref)} />;
          default:
            return <Input key={field.key} label={field.label} type={field.kind === "url" ? "url" : "text"} maxLength={field.max} value={String(value ?? "")} onChange={(event) => put(field.key, event.target.value)} />;
        }
      })}
    </div>
  );
}

const lists = new Map<OptionList, Promise<NaukriOption[]>>();
/** A Naukri dropdown, fetched once per page. */
function loadList(list: OptionList): Promise<NaukriOption[]> {
  if (!lists.has(list)) {
    lists.set(
      list,
      naukriDropdown({ list }).then((result) => {
        if (result.ok) return result.data;
        lists.delete(list);
        toast(result.error);
        return [];
      }),
    );
  }
  return lists.get(list)!;
}

function OptionSelect({ label, list, parent, optional, value, onChange }: { label: string; list: OptionList; parent?: number; optional?: boolean; value: NaukriTag | null; onChange: (tag: NaukriTag | null) => void }) {
  const [options, setOptions] = useState<NaukriOption[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadList(list).then((loaded) => live && setOptions(loaded));
    return () => {
      live = false;
    };
  }, [list]);
  const shown = (options ?? []).filter((option) => parent === undefined || option.parentId === parent);
  const known = value && shown.some((option) => option.id === value.id);
  return (
    <Select
      label={label}
      value={value ? String(value.id) : ""}
      onChange={(event) => {
        const option = shown.find((entry) => String(entry.id) === event.target.value);
        onChange(option ? { id: option.id, name: option.name } : null);
      }}
    >
      {(optional || !value) && <option value="">{options ? "Choose…" : "Loading…"}</option>}
      {value && !known && value.name && <option value={String(value.id)}>{value.name}</option>}
      {shown.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </Select>
  );
}

/** Naukri's best match for a name, or null (said in a toast). */
async function lookUp(type: LookupType, name: string): Promise<NaukriTag | null> {
  const result = toastResult(await lookUpNaukriTag({ type, name }));
  if (!result.ok) return null;
  if (!result.data) toast(`Naukri doesn't know “${name}”. Try how Naukri spells it.`);
  return result.data;
}

/**
 * A company, role, skill, institute, certificate or city: typed as text, and
 * matched to Naukri's entry when the box loses focus. Without a match it
 * stays as typed, except a city, which needs one.
 */
function RefInput({ label, type, value, onChange }: { label: string; type: LookupType; value: { id: string | number | null; name: string } | null; onChange: (value: unknown) => void }) {
  const [text, setText] = useState(value?.name ?? "");
  const [looking, setLooking] = useState(false);
  const city = type === "location";
  const [shownName, setShownName] = useState(value?.name ?? "");
  if ((value?.name ?? "") !== shownName) {
    // The value changed from outside (a suggestion): show it.
    setShownName(value?.name ?? "");
    setText(value?.name ?? "");
  }
  const match = async () => {
    const name = text.trim();
    if (name === (value?.name ?? "") && (value?.id || !name)) return;
    if (name.length < 2) return onChange(city ? null : { id: null, name });
    setLooking(true);
    const found = await lookUp(type, name);
    setLooking(false);
    if (found) onChange(city ? found : { id: String(found.id), name: found.name });
    else if (!city) onChange({ id: null, name });
    else setText(value?.name ?? "");
  };
  return (
    <Input
      label={label}
      value={text}
      hint={looking ? "Looking it up on Naukri…" : value?.id ? "Matched on Naukri" : value?.name ? "Not matched: saved as typed" : undefined}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => void match()}
    />
  );
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
