"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { RemovableChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { sameName } from "@/lib/profile";

import { updateSettings } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

/** A removable-chip list with an add box, saving the whole list to one setting. */
function ListEditor({
  title,
  hint,
  items,
  field,
  listLabel,
  addLabel,
  placeholder,
  maxLength,
}: {
  title: string;
  hint: string;
  items: string[];
  field: "projectKinds" | "jobTypes";
  listLabel: string;
  addLabel: string;
  placeholder: string;
  maxLength: number;
}) {
  const track = useTrackSave();
  const [list, setList] = useState(items);
  const [draft, setDraft] = useState("");

  const save = (next: string[]) => {
    const previous = list;
    setList(next);
    void track(updateSettings({ [field]: next })).then((result) => {
      if (!toastResult(result).ok) setList(previous);
    });
  };

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    setDraft("");
    if (list.some((item) => sameName(item, name))) return toast(`“${name}” is already in the list.`);
    save([...list, name]);
  };

  return (
    <Card className="flex flex-col gap-4 px-7 py-6">
      <h4 className="text-lead font-medium">{title}</h4>
      <p className="text-meta text-muted">{hint}</p>
      {list.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={listLabel}>
          {list.map((item) => (
            <li key={item}>
              <RemovableChip removeLabel={`Remove ${item}`} onRemove={() => save(list.filter((other) => other !== item))}>
                {item}
              </RemovableChip>
            </li>
          ))}
        </ul>
      )}
      <Input
        aria-label={addLabel}
        placeholder={placeholder}
        maxLength={maxLength}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          add();
        }}
        enterKeyHint="done"
      />
    </Card>
  );
}

/** Settings → Profile: the choices the Experience and Projects sections offer. */
export function ProfileSection({ initial }: { initial: { projectKinds: string[]; jobTypes: string[] } }) {
  return (
    <>
      <SettingsSectionIntro title="Profile">The choices your profile sections offer.</SettingsSectionIntro>
      <h3 className="font-serif text-section">Experience</h3>
      <ListEditor
        title="Job types"
        hint="The choices for a role in Profile → Experience. Removing one leaves the roles that use it as they are."
        items={initial.jobTypes}
        field="jobTypes"
        listLabel="Job types"
        addLabel="New job type"
        placeholder="e.g. Freelance"
        maxLength={40}
      />
      <h3 className="font-serif text-section">Projects</h3>
      <ListEditor
        title="Other project kinds"
        hint="What a project can be part of under Profile → Projects, besides one of your roles or degrees."
        items={initial.projectKinds}
        field="projectKinds"
        listLabel="Project kinds"
        addLabel="Add a project kind"
        placeholder="e.g. Hackathon"
        maxLength={60}
      />
    </>
  );
}
