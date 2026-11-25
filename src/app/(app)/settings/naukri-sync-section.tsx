"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RemovableChip } from "@/components/ui/chip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SOURCES, type Source } from "@/lib/applications-list";
import { DEFAULT_NAUKRI_STATUS_MAP, duplicateNaukriWord, NAUKRI_MAPPED_STATUSES, normalizeNaukriWord, type NaukriMappedStatus, type NaukriStatusMap } from "@/lib/naukri-status";
import { statusInfo } from "@/lib/status";

import { syncNaukriNow } from "../applications/actions";
import { updateSettings } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

import { Toggle } from "@/components/ui/toggle";

export type NaukriSyncView = {
  on: boolean;
  visibility: Source;
  hours: number;
  days: number;
  limit: number;
  lastSyncAt: string | null;
  problem: string | null;
  statusMap: NaukriStatusMap;
  unmapped: string[];
};

type NumberKey = "hours" | "days" | "limit";
const NUMBERS: { key: NumberKey; setting: "naukriSyncHours" | "naukriSyncDays" | "naukriSyncLimit"; label: string; hint: string; min: number; max: number }[] = [
  { key: "hours", setting: "naukriSyncHours", label: "Fetch every (hours)", hint: "How often the sync runs while it's on.", min: 1, max: 168 },
  { key: "days", setting: "naukriSyncDays", label: "Look back (days)", hint: "Only applications from this many days are fetched.", min: 1, max: 365 },
  { key: "limit", setting: "naukriSyncLimit", label: "Most applications", hint: "The newest this many are fetched each time.", min: 1, max: 500 },
];

/** Settings → Job search → Naukri applications: the sync's switch, what shows, how much to fetch, and "Sync now". */
export function NaukriSyncSection({ initial }: { initial: NaukriSyncView }) {
  const track = useTrackSave();
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [drafts, setDrafts] = useState<Record<NumberKey, string>>({ hours: String(initial.hours), days: String(initial.days), limit: String(initial.limit) });
  const [typed, setTyped] = useState<Record<NaukriMappedStatus, string>>(() => blank());
  const [syncing, startSync] = useTransition();

  const save = (changes: Parameters<typeof updateSettings>[0], rollback: () => void) =>
    void track(updateSettings(changes)).then((result) => {
      if (!result.ok) {
        rollback();
        toast(result.error);
      }
    });

  const switchSync = (on: boolean) => {
    setView((current) => ({ ...current, on }));
    save({ naukriSync: on }, () => setView((current) => ({ ...current, on: !on })));
  };

  const show = (visibility: Source) => {
    const before = view.visibility;
    setView((current) => ({ ...current, visibility }));
    save({ naukriVisibility: visibility }, () => setView((current) => ({ ...current, visibility: before })));
  };

  const saveNumber = ({ key, setting, min, max }: (typeof NUMBERS)[number]) => {
    const value = Number(drafts[key]);
    if (!Number.isInteger(value) || value < min || value > max) {
      setDrafts((current) => ({ ...current, [key]: String(view[key]) }));
      return toast(`Enter a whole number from ${min} to ${max}.`);
    }
    if (value === view[key]) return;
    const before = view[key];
    setView((current) => ({ ...current, [key]: value }));
    save({ [setting]: value }, () => {
      setView((current) => ({ ...current, [key]: before }));
      setDrafts((current) => ({ ...current, [key]: String(before) }));
    });
  };

  const saveWords = (status: NaukriMappedStatus, list: string[]) => {
    const before = view.statusMap;
    const next = { ...before, [status]: list };
    const duplicate = duplicateNaukriWord(next);
    if (duplicate) return toast(`“${duplicate}” is already listed under another status.`);
    setView((current) => ({ ...current, statusMap: next }));
    save({ naukriStatusMap: next }, () => setView((current) => ({ ...current, statusMap: before })));
  };

  const addWord = (status: NaukriMappedStatus) => {
    const word = typed[status].trim();
    if (!word) return;
    setTyped((current) => ({ ...current, [status]: "" }));
    if (view.statusMap[status].some((other) => normalizeNaukriWord(other) === normalizeNaukriWord(word))) return toast(`“${word}” is already in the list.`);
    saveWords(status, [...view.statusMap[status], word]);
  };

  const resetWords = () => {
    const before = view.statusMap;
    setView((current) => ({ ...current, statusMap: DEFAULT_NAUKRI_STATUS_MAP }));
    save({ naukriStatusMap: DEFAULT_NAUKRI_STATUS_MAP }, () => setView((current) => ({ ...current, statusMap: before })));
  };

  const sync = () =>
    startSync(async () => {
      const result = toastResult(await syncNaukriNow({}));
      if (result.ok) {
        const { created, updated, total } = result.data;
        toast(`Synced ${total} from Naukri: ${created} new, ${updated} updated.`);
        setView((current) => ({ ...current, lastSyncAt: new Date().toISOString(), problem: null, unmapped: result.data.unmapped }));
      }
      router.refresh();
    });

  return (
    <>
      <SettingsSectionIntro title="Naukri applications">
        Bring the jobs you applied for on Naukri into Applications, with Naukri&apos;s own status. It uses the NopeRi server above and the Naukri sign-in it holds.
      </SettingsSectionIntro>
      <Card className="flex flex-col gap-5">
        <Toggle
          label="Sync applications from Naukri"
          description="Fetches in the background and on “Sync Naukri” on the Applications screen. Naukri's status wins for the applications it knows."
          checked={view.on}
          onCheckedChange={switchSync}
        />
        <div className="flex flex-col gap-2">
          <span className="text-label text-muted">Show on Applications</span>
          <SegmentedControl<Source>
            aria-label="Show on Applications"
            size="sm"
            options={SOURCES.map(({ value }) => ({ value, label: value === "dossier" ? "Dossier only" : value === "naukri" ? "Naukri only" : "Both" }))}
            value={view.visibility}
            onValueChange={show}
          />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
          {NUMBERS.map((entry) => (
            <Input
              key={entry.key}
              label={entry.label}
              hint={entry.hint}
              type="number"
              inputMode="numeric"
              min={entry.min}
              max={entry.max}
              value={drafts[entry.key]}
              onChange={(event) => setDrafts((current) => ({ ...current, [entry.key]: event.target.value }))}
              onBlur={() => saveNumber(entry)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3.5">
          <Button variant="secondary" onClick={sync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
          <span className={view.problem ? "text-meta text-error" : "text-meta text-muted"}>
            {view.problem ?? (view.lastSyncAt ? `Last synced ${new Date(view.lastSyncAt).toISOString().slice(0, 16).replace("T", " ")} UTC` : "Not synced yet.")}
          </span>
        </div>
      </Card>

      <SettingsSectionIntro title="Naukri status words">
        The words Naukri uses for an application&apos;s status, as chips under the Dossier status they mean. Matching ignores case and a longer word wins (“Not Shortlisted” over “Shortlisted”), so you can fix a renamed word here.
      </SettingsSectionIntro>
      <Card className="flex flex-col gap-5">
        <div className="flex flex-col gap-5">
          {NAUKRI_MAPPED_STATUSES.map((status) => (
            <div key={status} className="flex flex-col gap-2.5">
              <h4 className="text-lead font-medium">{statusInfo(status).label}</h4>
              {view.statusMap[status].length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label={`Naukri words for ${statusInfo(status).label}`}>
                  {view.statusMap[status].map((word) => (
                    <li key={word}>
                      <RemovableChip removeLabel={`Remove ${word}`} onRemove={() => saveWords(status, view.statusMap[status].filter((other) => other !== word))}>
                        {word}
                      </RemovableChip>
                    </li>
                  ))}
                </ul>
              )}
              <Input
                aria-label={`New Naukri word for ${statusInfo(status).label}`}
                placeholder="Type a Naukri status word and press Enter"
                maxLength={60}
                value={typed[status]}
                onChange={(event) => setTyped((current) => ({ ...current, [status]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addWord(status);
                }}
                enterKeyHint="done"
              />
            </div>
          ))}
        </div>
        {view.unmapped.length > 0 && (
          <p className="text-meta text-muted">
            Seen on Naukri but not listed (treated as Sent): {view.unmapped.map((word) => `“${word}”`).join(", ")}. Add them above.
          </p>
        )}
        <div>
          <Button variant="secondary" onClick={resetWords}>
            Reset to defaults
          </Button>
        </div>
      </Card>
    </>
  );
}

const blank = (): Record<NaukriMappedStatus, string> => Object.fromEntries(NAUKRI_MAPPED_STATUSES.map((status) => [status, ""])) as Record<NaukriMappedStatus, string>;
