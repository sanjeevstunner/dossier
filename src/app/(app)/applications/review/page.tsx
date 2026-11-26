import type { Metadata } from "next";

import { loadConflicts } from "@/lib/naukri-conflicts";

import { ReviewScreen } from "./review-screen";

export const metadata: Metadata = { title: "Review Naukri changes" };
export const dynamic = "force-dynamic";

/** Applications whose status you set and Naukri disagrees with, for you to decide. */
export default async function ReviewPage() {
  const conflicts = await loadConflicts();
  return <ReviewScreen items={conflicts.map(({ statusSince, ...rest }) => ({ ...rest, statusSince: statusSince?.toISOString() ?? null }))} />;
}
