import { formatCalendarDate, formatDate } from "@/lib/dates";
import { SOURCE_INFO } from "@/lib/job-search/sources";
import type { JobSource } from "@/lib/job-search/search";

type Found = { source: JobSource; via: string };

/** Where the application came from, e.g. "From Find jobs on LinkedIn via JSearch", or "Added by you". */
export function sourceLine({ posting, agentCandidate, startup }: {
  posting: Found | null;
  agentCandidate: (Found & { agent: { name: string } | null }) | null;
  startup: { source: string } | null;
}): string {
  const board = ({ source, via }: Found) => {
    const name = SOURCE_INFO[source].name;
    return via.trim() && via.trim() !== name ? `${via.trim()} via ${name}` : name;
  };
  if (agentCandidate) return `From ${agentCandidate.agent?.name ?? "the job agent"} on ${board(agentCandidate)}`;
  if (posting) return `From Find jobs on ${board(posting)}`;
  if (startup) return `From Startups on ${startup.source}`;
  return "Added by you";
}

/** Location · work mode · salary · "Apply by …" · source · "Created …", leaving out empty parts (APP-1). */
export function metaLine(application: {
  location: string;
  mode: string;
  salary: string;
  deadline: Date | null;
  createdAt: Date;
}, source = ""): string[] {
  return [
    application.location.trim(),
    application.mode.trim(),
    application.salary.trim(),
    application.deadline ? `Apply by ${formatCalendarDate(application.deadline)}` : "",
    source,
    `Created ${formatDate(application.createdAt)}`,
  ].filter(Boolean);
}
