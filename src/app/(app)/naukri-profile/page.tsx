import type { Metadata } from "next";

import { isAiConfigured } from "@/lib/ai/config";
import { credentialsFor, loadJobSearchConfig, requestContext } from "@/lib/job-search/config";
import { asProblem } from "@/lib/job-search/find";
import { naukriEditableProfile } from "@/lib/job-search/naukri";

import { NaukriProfileScreen } from "./naukri-profile-screen";

export const metadata: Metadata = { title: "Naukri profile" };

/**
 * Naukri profile: tailor the Naukri profile for a target role. The AI
 * suggests a headline, summary, key skills and roles; the form gives
 * locations, salary and notice period. Nothing changes on Naukri until the
 * accepted suggestions are sent.
 */
export default async function NaukriProfilePage() {
  const [current, aiReady] = await Promise.all([
    asProblem(async () => ({ ok: true as const, profile: await naukriEditableProfile(credentialsFor(await loadJobSearchConfig(), "NAUKRI"), requestContext("NAUKRI")) })),
    isAiConfigured(),
  ]);
  return <NaukriProfileScreen current={current.ok ? current.profile : null} problem={current.ok ? null : current} aiReady={aiReady} />;
}
