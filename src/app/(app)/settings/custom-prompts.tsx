"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";

import { updateSettings } from "./actions";

type Scope = "Global" | "Docs" | "Resume" | "Agent";
type Prompts = { customPrompts: boolean } & { [K in Scope as `prompt${K}`]: string } & { [K in Scope as `prompt${K}On`]: boolean };

const ROWS: { scope: Scope; label: string; description: string }[] = [
  { scope: "Global", label: "Global prompt", description: "Added to everything the AI writes." },
  { scope: "Docs", label: "Resume, cover letter and email prompt", description: "Added when writing or editing any of the three documents." },
  { scope: "Resume", label: "Resume prompt", description: "Added only when writing or editing the resume, on top of the document prompt." },
  { scope: "Agent", label: "Agent prompt", description: "Added to the agent's answers to application questions and to its replies to employers." },
];

/**
 * Your own standing instructions for the AI (custom prompts). Nothing is sent
 * unless the master switch and the prompt's own switch are both on. Switches
 * save as they change, text when you leave the field.
 */
export function CustomPrompts({ initial }: { initial: Prompts }) {
  const track = useTrackSave();
  const [state, setState] = useState(initial);

  const change = (next: Partial<Prompts>) => {
    const previous = state;
    setState({ ...state, ...next });
    void track(updateSettings(next)).then((result) => {
      if (!toastResult(result).ok) setState(previous);
    });
  };

  return (
    <Card padding="none" className="flex flex-col px-7 pt-1.5 pb-2.5">
      <Toggle
        className="py-4"
        label="Use custom prompts"
        description="Master switch. Off, none of the prompts below are sent to the AI, though they stay saved."
        checked={state.customPrompts}
        onCheckedChange={(customPrompts) => change({ customPrompts })}
      />
      {ROWS.map(({ scope, label, description }) => {
        const text = `prompt${scope}` as const;
        const on = `prompt${scope}On` as const;
        return (
          <div key={scope} className="flex flex-col gap-3 border-t border-line py-4" aria-disabled={!state.customPrompts}>
            <Toggle
              label={label}
              description={description}
              checked={state[on]}
              disabled={!state.customPrompts}
              onCheckedChange={(value) => change({ [on]: value })}
            />
            <Textarea
              aria-label={label}
              rows={4}
              maxLength={4000}
              disabled={!state.customPrompts}
              placeholder="Write your instructions here."
              value={state[text]}
              onChange={(event) => setState({ ...state, [text]: event.target.value })}
              onBlur={() => change({ [text]: state[text] })}
            />
          </div>
        );
      })}
    </Card>
  );
}
