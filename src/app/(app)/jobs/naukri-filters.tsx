"use client";

import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { NAUKRI_FILTER_GROUPS, type SearchFilters } from "@/lib/job-search/search";

const SHOWN = 4;

type Chosen = Record<string, string[]>;

/** Naukri's filters for a search, with how many postings each leaves; ticking one runs the search again with it. */
export function NaukriFilters({
  filters,
  chosen = {},
  disabled = false,
  onChange,
}: {
  filters: SearchFilters;
  chosen?: Chosen;
  disabled?: boolean;
  onChange: (chosen: Chosen | undefined) => void;
}) {
  const applied = Object.values(chosen).flat().length;
  const toggle = (key: string, id: string) => {
    const ids = chosen[key] ?? [];
    const next = { ...chosen, [key]: ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id] };
    if (!next[key].length) delete next[key];
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <aside aria-label="Filters" className="flex min-w-0 flex-[1_1_220px] flex-col gap-5 rounded-panel border border-line-card bg-card p-5 lg:max-w-[260px]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">Filters</h2>
        {applied > 0 && (
          <button
            type="button"
            onClick={disabled ? undefined : () => onChange(undefined)}
            aria-disabled={disabled || undefined}
            className="text-meta text-primary-text underline underline-offset-3 aria-disabled:text-faint"
          >
            Clear {applied}
          </button>
        )}
      </div>
      {filters.groups.map((group) => (
        <FilterGroup key={group.key} group={group} chosen={chosen[group.key] ?? []} disabled={disabled} onToggle={(id) => toggle(group.key, id)} />
      ))}
    </aside>
  );
}

function FilterGroup({
  group,
  chosen,
  disabled,
  onToggle,
}: {
  group: SearchFilters["groups"][number];
  chosen: string[];
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  // Ticked options stay in view even past the first few.
  const options = all ? group.options : group.options.filter((option, index) => index < SHOWN || chosen.includes(option.id));
  return (
    <fieldset className="flex flex-col gap-2 border-t border-line-card pt-4">
      <legend className="float-left mb-1 text-meta font-medium">{NAUKRI_FILTER_GROUPS[group.key] ?? group.key}</legend>
      {options.map((option) => (
        <Checkbox
          key={option.id}
          checked={chosen.includes(option.id)}
          disabled={disabled}
          onChange={() => onToggle(option.id)}
          label={
            <span>
              {option.label} <span className="text-muted">({option.count.toLocaleString("en-IN")})</span>
            </span>
          }
        />
      ))}
      {(all || options.length < group.options.length) && (
        <button type="button" onClick={() => setAll(!all)} className="w-fit text-meta text-primary-text underline underline-offset-3">
          {all ? "Show fewer" : `View ${group.options.length - options.length} more`}
        </button>
      )}
    </fieldset>
  );
}
