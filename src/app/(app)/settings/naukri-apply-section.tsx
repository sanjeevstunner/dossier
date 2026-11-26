"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";

import { updateSettings } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

export type NaukriApply = {
  easyApplyAnswerQuestions: boolean;
  easyApplyTailorResume: boolean;
  easyApplySwapResume: boolean;
  easyApplyAutoSubmit: boolean;
  confirmApplyAnswers: boolean;
  confirmApplyResume: boolean;
};

/**
 * Which steps Naukri easy apply with agent may do on its own. Each control
 * saves as it changes; a step that's off is left to you, and nothing is sent
 * until the steps that are on have finished.
 */
export function NaukriApplySection({ initial }: { initial: NaukriApply }) {
  const track = useTrackSave();
  const [apply, setApply] = useState(initial);

  const change = (next: Partial<NaukriApply>) => {
    const previous = apply;
    setApply({ ...apply, ...next });
    void track(updateSettings(next)).then((result) => {
      if (!toastResult(result).ok) setApply(previous);
    });
  };

  // The resume goes out only when it's tailored and swapped in.
  const sendsResume = apply.easyApplyTailorResume && apply.easyApplySwapResume;

  return (
    <>
      <SettingsSectionIntro title="Naukri easy apply agent">
        Choose what the agent may do for you on Naukri. Anything you turn off, you do yourself.
      </SettingsSectionIntro>
      <Card padding="none" className="flex flex-col px-7 pt-1.5 pb-2.5">
        <Toggle
          className="py-4"
          label="Tailor the resume"
          description="Write a resume for each job. Off: the resume already on your Naukri profile goes out."
          checked={apply.easyApplyTailorResume}
          onCheckedChange={(easyApplyTailorResume) => change({ easyApplyTailorResume })}
        />
        {apply.easyApplyTailorResume && (
          <Toggle
            className="py-4 pl-8"
            label="Send the tailored resume with the apply"
            description="Puts it on your Naukri profile for the apply, then restores the original. Off: it's kept on the application only."
            checked={apply.easyApplySwapResume}
            onCheckedChange={(easyApplySwapResume) => change({ easyApplySwapResume })}
          />
        )}
        <Toggle
          className="border-t border-line py-4"
          label="Answer questions with AI"
          description="Answers the job's questionnaire from your profile. Off: the agent stops when a job asks something Naukri doesn't fill from your profile."
          checked={apply.easyApplyAnswerQuestions}
          onCheckedChange={(easyApplyAnswerQuestions) => change({ easyApplyAnswerQuestions })}
        />
        {apply.easyApplyAnswerQuestions && (
          <Toggle
            className="py-4 pl-8"
            label="Confirm easy apply answers"
            description="Shows the answers it would send, and your resume, so you can edit them first. Then send them with the agent, or keep it as a draft."
            checked={apply.confirmApplyAnswers}
            onCheckedChange={(confirmApplyAnswers) => change({ confirmApplyAnswers })}
          />
        )}
        {apply.easyApplyAnswerQuestions && apply.confirmApplyAnswers && sendsResume && (
          <Toggle
            className="py-4 pl-16"
            label="Also confirm the resume"
            description="Before anything is sent, show the resume that goes with the apply too. Leave it off to confirm only the answers."
            checked={apply.confirmApplyResume}
            onCheckedChange={(confirmApplyResume) => change({ confirmApplyResume })}
          />
        )}
        <Toggle
          className="border-t border-line py-4"
          label="Submit the application"
          description="Applies on Naukri and moves the application to Sent. Off: it prepares everything and leaves a draft, and you apply yourself."
          checked={apply.easyApplyAutoSubmit}
          onCheckedChange={(easyApplyAutoSubmit) => change({ easyApplyAutoSubmit })}
        />
      </Card>
    </>
  );
}
