"use client";

import { useMemo } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAutosave } from "@/hooks/use-autosave";
import {
  associationLabel,
  educationLabel,
  experienceLabel,
  formatDateRange,
  type EntryOrder,
  type ProfileData,
  type ProjectItem,
} from "@/lib/profile";

import {
  attachNewProjectSkill,
  createProject,
  removeProject,
  reorderEntries,
  restoreProject,
  saveProject,
  setProjectSkill,
  sortEntriesByDate,
} from "./actions";
import { EntryList } from "./entry-list";
import { MonthYearField } from "./month-year-field";
import type { UpdateProfile } from "./skills-section";
import { SkillsUsed } from "./skills-used";

/** The fields of an open project, autosaved as you type. */
function ProjectForm({
  entry,
  onChange,
  autoFocus,
  profile,
  kinds,
}: {
  entry: ProjectItem;
  onChange: (entry: ProjectItem) => void;
  autoFocus: boolean;
  profile: ProfileData;
  kinds: string[];
}) {
  const track = useTrackSave();
  // Autosave the text and dates only; skill links save on their own when toggled.
  const { id, name, link, association, bullets, startYear, startMonth, endYear, endMonth, current } = entry;
  const fields = useMemo(
    () => ({ id, name, link, association, bullets, startYear, startMonth, endYear, endMonth, current }),
    [id, name, link, association, bullets, startYear, startMonth, endYear, endMonth, current],
  );
  // A role or degree that was deleted reads as None; a kind since removed from Settings stays listed.
  const selected = associationLabel(association, profile) ? association : "";
  // Roles and degrees not filled in yet have nothing to show, so they aren't offered.
  const roles = profile.experience.filter((item) => experienceLabel(item));
  const degrees = profile.education.filter((item) => educationLabel(item));
  const otherKinds = selected.startsWith("other:") && !kinds.includes(selected.slice(6)) ? [...kinds, selected.slice(6)] : kinds;
  const { flush } = useAutosave(fields, (value) => track(saveProject(value)));
  const set = (change: Partial<ProjectItem>) => onChange({ ...entry, ...change });

  return (
    <div className="grid grid-cols-2 gap-[18px]" onBlur={flush}>
      <Input
        label="Project"
        placeholder="Churn predictor"
        value={entry.name}
        onChange={(event) => set({ name: event.target.value })}
        autoFocus={autoFocus}
      />
      <Input
        label="Link"
        placeholder="github.com/you/churn-predictor"
        value={entry.link}
        onChange={(event) => set({ link: event.target.value })}
      />
      <Select className="col-span-2" label="Part of" value={selected} onChange={(event) => set({ association: event.target.value })}>
        <option value="">None</option>
        {roles.length > 0 && (
          <optgroup label="Experience">
            {roles.map((item) => (
              <option key={item.id} value={`experience:${item.id}`}>
                {experienceLabel(item)}
              </option>
            ))}
          </optgroup>
        )}
        {degrees.length > 0 && (
          <optgroup label="Education">
            {degrees.map((item) => (
              <option key={item.id} value={`education:${item.id}`}>
                {educationLabel(item)}
              </option>
            ))}
          </optgroup>
        )}
        {otherKinds.length > 0 && (
          <optgroup label="Other">
            {otherKinds.map((kind) => (
              <option key={kind} value={`other:${kind}`}>
                {kind}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
      <MonthYearField
        label="Started"
        value={{ month: entry.startMonth, year: entry.startYear }}
        onChange={({ month, year }) => set({ startMonth: month, startYear: year })}
      />
      <div className="flex flex-col gap-2.5">
        <MonthYearField
          label="Finished"
          value={{ month: entry.endMonth, year: entry.endYear }}
          onChange={({ month, year }) => set({ endMonth: month, endYear: year })}
          disabled={entry.current}
        />
        <Checkbox
          label="Still working on it"
          checked={entry.current}
          onChange={(event) => set({ current: event.target.checked })}
        />
      </div>
      <Textarea
        className="col-span-2"
        label="What you did"
        placeholder="One point per line: what you built, how, and what came of it."
        rows={4}
        value={entry.bullets}
        onChange={(event) => set({ bullets: event.target.value })}
      />
    </div>
  );
}

/** Projects (PRO-13): side, open-source, course or thesis work, with the skills used, like roles. */
export function ProjectsSection({
  profile,
  update,
  order,
  kinds,
}: {
  profile: ProfileData;
  update: UpdateProfile;
  order: EntryOrder;
  /** The "Other" kinds a project can be part of, from Settings → Profile. */
  kinds: string[];
}) {
  const skillNames = (entry: ProjectItem) =>
    profile.skills.filter((skill) => entry.skillIds.includes(skill.id)).map((skill) => skill.name);

  return (
    <EntryList
      items={profile.projects}
      setItems={(change) => update((current) => ({ ...current, projects: change(current.projects) }))}
      addLabel="Add a project"
      ordering={{
        mode: order,
        save: (ids) => reorderEntries({ section: "project", ids }),
        sortByDate: () => sortEntriesByDate({ section: "project" }),
      }}
      summary={(entry) => ({
        title: entry.name.trim() || "New project",
        subtitle: [associationLabel(entry.association, profile), entry.link.trim()].filter(Boolean).join(" · "),
        meta: formatDateRange(entry),
        footnote: skillNames(entry).join(" · ") || undefined,
      })}
      create={() => createProject({})}
      remove={(entry) => removeProject({ id: entry.id })}
      restore={(entry) => restoreProject(entry)}
      renderForm={(entry, { onChange, autoFocus }) => (
        <>
          <ProjectForm entry={entry} onChange={onChange} autoFocus={autoFocus} profile={profile} kinds={kinds} />
          <SkillsUsed
            entry={entry}
            noun="project"
            skills={profile.skills}
            grouped={profile.groupSkills !== false}
            update={update}
            setLinks={(change) =>
              update((current) => ({
                ...current,
                projects: current.projects.map((item) => (item.id === entry.id ? { ...item, skillIds: change(item.skillIds) } : item)),
              }))
            }
            attach={(skillId, attached) => setProjectSkill({ projectId: entry.id, skillId, attached })}
            attachNew={(name) => attachNewProjectSkill({ projectId: entry.id, name })}
          />
        </>
      )}
    />
  );
}
