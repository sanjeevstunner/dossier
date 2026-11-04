"use client";

import Link from "next/link";
import { useState } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { useAutosave } from "@/hooks/use-autosave";
import type { AgentEditable } from "@/lib/agent/view";
import type { Country } from "@/lib/job-search/countries";
import { searchHref, type JobSource, type SearchQuery } from "@/lib/job-search/search";

import { RemoteOnlyField, SearchFields, type SearchFieldErrors } from "../../jobs/search-fields";
import { saveAgent } from "../actions";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MIN_SCORES = [50, 55, 60, 65, 70, 75, 80, 85, 90];
const SCORE_COUNTS = Array.from({ length: 30 }, (_, index) => index + 1);
const DRAFT_COUNTS = Array.from({ length: 11 }, (_, index) => index);
const RUN_LIMITS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 24];
const INTERVALS = [0, 15, 30, 60, 120, 240, 480];
// Monday first.
const WEEK = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 0, label: "Sun" },
];
const clock = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const intervalLabel = (minutes: number) => (minutes === 0 ? "No wait" : minutes < 60 ? `${minutes} minutes` : plural(minutes / 60, "hour", "hours"));

/** What each change saves; the screen keeps `enabled` in its header. */
export type ConfigChange = Partial<AgentEditable>;

/**
 * An agent's config (E16-7): the one search it runs, on which days and
 * after which hour, how much a run may do, and when Run now warns. Each
 * change saves at once; the search and name once typing pauses.
 */
export function AgentConfig({
  id,
  config,
  onChange,
  source,
  countries,
  timeZone,
  errors,
  setErrors,
  onDelete,
}: {
  id: string;
  config: AgentEditable;
  /** Applies a change locally; returns the previous config, to roll back to. */
  onChange: (change: ConfigChange) => AgentEditable;
  source: JobSource | null;
  countries: readonly Country[];
  timeZone: string;
  errors: SearchFieldErrors;
  setErrors: (errors: SearchFieldErrors) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(config.name);
  const save = (change: ConfigChange) => {
    const previous = onChange(change);
    void saveAgent({ id, ...change }).then((result) => {
      if (!toastResult(result).ok) onChange(previous);
    });
  };
  const { flush } = useAutosave(config.query, (query) => saveAgent({ id, query }));
  const { flush: flushName } = useAutosave(name, (value) => (value.trim() ? saveAgent({ id, name: value }) : Promise.resolve(null)));
  const setQuery = (patch: Partial<SearchQuery>) => {
    setErrors({});
    onChange({ query: { ...config.query, ...patch } });
  };
  const toggleDay = (day: number) => save({ days: config.days.includes(day) ? config.days.filter((entry) => entry !== day) : [...config.days, day] });

  return (
    <div className="flex flex-col gap-7">
      <Input
        label="Name"
        value={name}
        maxLength={100}
        onChange={(event) => {
          setName(event.target.value);
          onChange({ name: event.target.value });
        }}
        onBlur={flushName}
      />

      <Group title="What it looks for">
        <p className="text-meta text-muted">
          The same search as in{" "}
          <Link href={searchHref(config.query)} className="font-medium text-ink underline underline-offset-2">
            Find jobs
          </Link>
          , through the source in Settings → Job search. Postings you saved, dismissed or applied for there, or that another agent found, are left out.
        </p>
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2" onBlur={flush}>
          <SearchFields value={config.query} onChange={setQuery} source={source} countries={countries} errors={errors} />
          <div className="sm:col-span-2">
            <RemoteOnlyField value={config.query} onChange={setQuery} source={source} />
          </div>
        </div>
      </Group>

      <Group title="Repeats">
        <div role="group" aria-label="Runs on" className="flex flex-wrap gap-2">
          {WEEK.map(({ day, label }) => (
            <ToggleChip key={day} selected={config.days.includes(day)} onClick={() => toggleDay(day)}>
              {label}
            </ToggleChip>
          ))}
        </div>
        {config.days.length === 0 && <p className="text-meta text-warning">Choose at least one day, or it only runs with Run now.</p>}
        <Select label="Runs after" hint={`Your time (${timeZone})`} value={String(config.hour)} onChange={(event) => save({ hour: Number(event.target.value) })}>
          {HOURS.map((hour) => (
            <option key={hour} value={hour}>
              {clock(hour)}
            </option>
          ))}
        </Select>
      </Group>

      <Group title="Each run">
        <div className="grid gap-x-[18px] gap-y-5 sm:grid-cols-2">
          <Select label="Minimum score" hint="Postings scored lower stay out of the queue." value={String(config.minScore)} onChange={(event) => save({ minScore: Number(event.target.value) })}>
            {[...new Set([...MIN_SCORES, config.minScore])].sort((a, b) => a - b).map((score) => (
              <option key={score} value={score}>
                {score} of 100
              </option>
            ))}
          </Select>
          <Select label="Postings scored per run" value={String(config.maxScores)} onChange={(event) => save({ maxScores: Number(event.target.value) })}>
            {SCORE_COUNTS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </Select>
          <Toggle
            className="sm:col-span-2"
            label="Prepare drafts on its own"
            description={
              config.autoDraft
                ? `For the best new postings of each run, up to ${plural(config.maxDrafts, "draft", "drafts")}: a tailored resume and cover letter, waiting for your review.`
                : "Off. You choose which postings get a draft with Prepare draft."
            }
            checked={config.autoDraft}
            onCheckedChange={(autoDraft) => save({ autoDraft })}
          />
          <Select
            label="Drafts per run, at most"
            value={String(config.maxDrafts)}
            disabled={!config.autoDraft}
            hint={config.autoDraft ? undefined : "Turn on Prepare drafts on its own first"}
            onChange={(event) => save({ maxDrafts: Number(event.target.value) })}
          >
            {DRAFT_COUNTS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </Select>
        </div>
      </Group>

      <Group title="Run now warnings">
        <p className="text-meta text-muted">Run now warns before going past these, to spare your job source&apos;s quota. Run anyway always goes ahead.</p>
        <div className="grid gap-x-[18px] gap-y-5 sm:grid-cols-2">
          <Select label="Runs in 24 hours" value={String(config.maxRunsPerDay)} onChange={(event) => save({ maxRunsPerDay: Number(event.target.value) })}>
            {[...new Set([...RUN_LIMITS, config.maxRunsPerDay])].sort((a, b) => a - b).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </Select>
          <Select
            label="Wait between runs"
            value={String(config.manualIntervalMinutes)}
            onChange={(event) => save({ manualIntervalMinutes: Number(event.target.value) })}
          >
            {[...new Set([...INTERVALS, config.manualIntervalMinutes])].sort((a, b) => a - b).map((minutes) => (
              <option key={minutes} value={minutes}>
                {intervalLabel(minutes)}
              </option>
            ))}
          </Select>
        </div>
      </Group>

      <p className="text-meta text-muted">
        Scoring and drafts go to your AI provider with your profile, as a new application does; the job source only gets the search.
      </p>
      <Button variant="danger-text" size="sm" className="self-start" onClick={onDelete}>
        Delete agent
      </Button>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-field font-medium">{title}</h3>
      {children}
    </section>
  );
}
