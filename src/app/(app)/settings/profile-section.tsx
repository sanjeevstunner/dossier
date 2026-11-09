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

/** Settings → Profile: the "Other" kinds a project can be part of, besides a role or a degree. */
export function ProfileSection({ initial }: { initial: { projectKinds: string[] } }) {
  const track = useTrackSave();
  const [kinds, setKinds] = useState(initial.projectKinds);
  const [draft, setDraft] = useState("");

  const save = (next: string[]) => {
    const previous = kinds;
    setKinds(next);
    void track(updateSettings({ projectKinds: next })).then((result) => {
      if (!toastResult(result).ok) setKinds(previous);
    });
  };

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    setDraft("");
    if (kinds.some((kind) => sameName(kind, name))) return toast(`“${name}” is already in the list.`);
    save([...kinds, name]);
  };

  return (
    <>
      <SettingsSectionIntro title="Profile">
        What a project can be part of under Profile → Projects, besides one of your roles or degrees.
      </SettingsSectionIntro>
      <Card className="flex flex-col gap-4 px-7 py-6">
        <h3 className="text-lead font-medium">Other project kinds</h3>
        {kinds.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Project kinds">
            {kinds.map((kind) => (
              <li key={kind}>
                <RemovableChip removeLabel={`Remove ${kind}`} onRemove={() => save(kinds.filter((item) => item !== kind))}>
                  {kind}
                </RemovableChip>
              </li>
            ))}
          </ul>
        )}
        <Input
          aria-label="Add a project kind"
          placeholder="e.g. Hackathon"
          maxLength={60}
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
    </>
  );
}
