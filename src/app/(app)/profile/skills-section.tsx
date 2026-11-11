"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RemovableChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { LanguageLevel } from "@/generated/prisma/enums";
import { LANGUAGE_LEVELS, languageLevelLabel, sameName, shownSkillGroups, type ProfileData, type SkillItem } from "@/lib/profile";

import { updateSettings } from "../settings/actions";
import { addLanguage, addSkill, organiseSkills, removeLanguage, removeSkill, setLanguageLevel } from "./actions";
import { useTrackSave } from "@/components/save-tracker";

export type UpdateProfile = (change: (profile: ProfileData) => ProfileData) => void;

/** A card in the Skills & languages section: title, "{n} added", content. */
export function ChipCard({
  title,
  count,
  optional = false,
  children,
}: {
  title: string;
  count: number;
  /** Doesn't count towards Profile strength (#216). */
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4 px-7 py-6">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lead font-medium">
          {title}
          {optional && <span className="font-normal text-muted"> (optional)</span>}
        </h3>
        <span className="text-meta text-muted">{count} added</span>
      </div>
      {children}
    </Card>
  );
}

/** Skills (PRO-3): Enter adds one, × removes it everywhere. */
function SkillsCard({ profile, update }: { profile: ProfileData; update: UpdateProfile }) {
  const track = useTrackSave();
  const [draft, setDraft] = useState("");
  const [organising, setOrganising] = useState(false);

  const roleCount = (skillId: string) =>
    profile.experience.filter((entry) => entry.skillIds.includes(skillId)).length;

  async function add() {
    const name = draft.trim();
    if (!name) return;
    const existing = profile.skills.find((skill) => sameName(skill.name, name));
    if (existing) {
      setDraft("");
      toast(`“${existing.name}” is already in your skills.`);
      return;
    }
    setDraft("");
    const result = await track(addSkill({ name }));
    if (!result.ok) {
      setDraft(name);
      toast(result.error);
      return;
    }
    const { skill } = result.data;
    update((current) =>
      current.skills.some((entry) => entry.id === skill.id)
        ? current
        : { ...current, skills: [...current.skills, skill] },
    );
    if (profile.autoGroupSkills) void organise();
  }

  /** "Organise with AI": the AI groups every skill; the groups show here and on the resumes. */
  async function organise() {
    setOrganising(true);
    const result = await track(organiseSkills({}));
    setOrganising(false);
    if (!result.ok) {
      toast(result.error);
      return;
    }
    const groups = new Map(result.data.groups.map(({ id, group }) => [id, group]));
    update((current) => ({ ...current, skills: current.skills.map((skill) => ({ ...skill, group: groups.get(skill.id) ?? skill.group })) }));
  }

  /** Saves a switch in Settings and shows it here at once. */
  async function setSwitch(change: { groupSkills: boolean } | { autoGroupSkills: boolean }) {
    const before = profile;
    update((current) => ({ ...current, ...change }));
    const result = await track(updateSettings(change));
    if (!result.ok) {
      update(() => before);
      toast(result.error);
    }
  }

  async function remove(id: string) {
    const before = profile;
    // Removing a skill detaches it from every role too (PRO-3).
    update((current) => ({
      ...current,
      skills: current.skills.filter((skill) => skill.id !== id),
      experience: current.experience.map((entry) => ({
        ...entry,
        skillIds: entry.skillIds.filter((skillId) => skillId !== id),
      })),
    }));
    const result = await track(removeSkill({ id }));
    if (!result.ok) {
      update(() => before);
      toast(result.error);
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void add();
  };

  const groups = shownSkillGroups(profile);
  const chips = (skills: SkillItem[], label: string) => (
    <ul className="flex flex-wrap gap-2" aria-label={label}>
      {skills.map((skill) => {
        const roles = roleCount(skill.id);
        return (
          <li key={skill.id}>
            <RemovableChip
              meta={roles > 0 ? `${roles} ${roles === 1 ? "role" : "roles"}` : undefined}
              removeLabel={`Remove ${skill.name}`}
              onRemove={() => void remove(skill.id)}
            >
              {skill.name}
            </RemovableChip>
          </li>
        );
      })}
    </ul>
  );

  return (
    <ChipCard title="Skills" count={profile.skills.length}>
      {profile.skills.length > 0 &&
        (groups ? (
          groups.map((group) => (
            <section key={group.name} className="flex flex-col gap-2" aria-label={group.name}>
              <h4 className="text-meta font-medium text-muted">{group.name}</h4>
              {chips(group.skills, group.name)}
            </section>
          ))
        ) : (
          chips(profile.skills, "Your skills")
        ))}
      <Input
        aria-label="Add a skill"
        placeholder="e.g. Accessibility"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        enterKeyHint="done"
      />
      {profile.skills.length > 1 && (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex items-center gap-3">
            <Button variant="secondary" disabled={organising} onClick={() => void organise()}>
              {organising ? "Organising…" : "Organise with AI"}
            </Button>
            <span className="text-meta text-muted">Groups your skills so they&apos;re easy to scan, on the profile and on resumes.</span>
          </div>
          <Toggle
            label="Show skills in groups"
            description="Off shows every skill as one list, everywhere."
            checked={profile.groupSkills !== false}
            onCheckedChange={(groupSkills) => void setSwitch({ groupSkills })}
          />
          <Toggle
            label="Organise automatically"
            description="Groups your skills again whenever you add one."
            checked={profile.autoGroupSkills === true}
            onCheckedChange={(autoGroupSkills) => void setSwitch({ autoGroupSkills })}
          />
        </div>
      )}
    </ChipCard>
  );
}

function LevelOptions() {
  return LANGUAGE_LEVELS.map(({ value, label }) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}

/** Languages with a CEFR-style level (PRO-4). */
function LanguagesCard({ profile, update }: { profile: ProfileData; update: UpdateProfile }) {
  const track = useTrackSave();
  const [name, setName] = useState("");
  const [level, setLevel] = useState<LanguageLevel>(LanguageLevel.B1);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = profile.languages.find((language) => sameName(language.name, trimmed));
    setName("");
    if (existing) {
      // Adding a language that's already there updates its level (PRO-4).
      update((current) => ({
        ...current,
        languages: current.languages.map((language) =>
          language.id === existing.id ? { ...language, level } : language,
        ),
      }));
      toast(`Updated ${existing.name} to ${languageLevelLabel(level)}.`);
    }
    const result = await track(addLanguage({ name: trimmed, level }));
    if (!result.ok) {
      setName(trimmed);
      toast(result.error);
      return;
    }
    const { language } = result.data;
    update((current) =>
      current.languages.some((entry) => entry.id === language.id)
        ? current
        : { ...current, languages: [...current.languages, language] },
    );
  }

  async function changeLevel(id: string, next: LanguageLevel) {
    const before = profile;
    update((current) => ({
      ...current,
      languages: current.languages.map((language) => (language.id === id ? { ...language, level: next } : language)),
    }));
    const result = await track(setLanguageLevel({ id, level: next }));
    if (!result.ok) {
      update(() => before);
      toast(result.error);
    }
  }

  async function remove(id: string) {
    const before = profile;
    update((current) => ({ ...current, languages: current.languages.filter((language) => language.id !== id) }));
    const result = await track(removeLanguage({ id }));
    if (!result.ok) {
      update(() => before);
      toast(result.error);
    }
  }

  return (
    <ChipCard title="Languages" count={profile.languages.length} optional>
      {profile.languages.length > 0 && (
        <ul className="flex flex-col border-t border-line" aria-label="Your languages">
          {profile.languages.map((language) => (
            <li key={language.id} className="flex items-center gap-3 border-b border-line py-2.5">
              <span className="min-w-0 flex-1 text-field">{language.name}</span>
              <Select
                aria-label={`${language.name} level`}
                selectClassName="w-auto text-sm"
                value={language.level}
                onChange={(event) => void changeLevel(language.id, event.target.value as LanguageLevel)}
              >
                <LevelOptions />
              </Select>
              <button
                type="button"
                aria-label={`Remove ${language.name}`}
                onClick={() => void remove(language.id)}
                className="rounded-control px-1.5 py-1 text-base leading-none text-muted hover:text-ink"
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-0 flex-[1_1_180px]"
          aria-label="Language"
          placeholder="Language, e.g. French"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void add();
          }}
        />
        <Select
          className="flex-[0_1_220px]"
          aria-label="Level"
          selectClassName="text-sm"
          value={level}
          onChange={(event) => setLevel(event.target.value as LanguageLevel)}
        >
          <LevelOptions />
        </Select>
        <Button variant="secondary" className="bg-input" onClick={() => void add()}>
          Add
        </Button>
      </div>
    </ChipCard>
  );
}

/** The Skills & languages section. */
export function SkillsSection({ profile, update }: { profile: ProfileData; update: UpdateProfile }) {
  return (
    <div className="flex flex-col gap-4">
      <SkillsCard profile={profile} update={update} />
      <LanguagesCard profile={profile} update={update} />
    </div>
  );
}
