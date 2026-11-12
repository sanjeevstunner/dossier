import "server-only";

import { DocumentKind, type ApplicationStatus } from "@/generated/prisma/enums";
import { matchSchema, matchScore } from "@/lib/application-data";
import { sortRows, updatedAgo, type Sort } from "@/lib/applications-list";
import { formatCalendarDate, formatShortDate } from "@/lib/dates";
import { prisma } from "@/lib/prisma";

/** An application as the board and the table show it (E9-2, E9-3). */
export type ApplicationRow = {
  id: string;
  company: string;
  /** The role, or the title when there's no role. */
  role: string;
  location: string;
  mode: string;
  status: ApplicationStatus;
  archived: boolean;
  /** "Apply by" on draft cards, e.g. "3 Oct 2026". */
  deadline: string | null;
  match: { hit: number; total: number } | null;
  /** The posting's fit with the profile, 0–100, kept when a saved posting was scored. */
  score: number | null;
  /** The user uploaded their own resume, which lets a scored application be marked sent. */
  hasUploadedResume: boolean;
  /** Came from a Naukri posting, so the job agent can apply for it. */
  agentApply: boolean;
  /** When it was sent, e.g. "18 Aug"; null while never sent. */
  sent: string | null;
  /** "Today", "3 days ago"… */
  updated: string;
  /** For the board, which shows the latest update first. */
  updatedAt: number;
};

/** Every application, archived ones only when asked for, sorted for the table; agent drafts once approved (#195). */
export async function loadApplicationRows({ archived, sort }: { archived: boolean; sort: Sort }, now = new Date()) {
  const applications = await prisma.application.findMany({
    where: { awaitingReview: false, ...(archived ? {} : { archivedAt: null }) },
    select: {
      id: true,
      title: true,
      company: true,
      role: true,
      location: true,
      mode: true,
      status: true,
      archivedAt: true,
      deadline: true,
      match: true,
      score: true,
      files: { where: { kind: DocumentKind.RESUME }, select: { id: true } },
      posting: { select: { source: true } },
      sentAt: true,
      updatedAt: true,
    },
  });
  const rows = applications.map((application) => {
    const match = matchSchema.safeParse(application.match);
    return {
      id: application.id,
      company: application.company.trim(),
      role: application.role.trim() || application.title.trim() || "Untitled application",
      location: application.location.trim(),
      mode: application.mode.trim(),
      status: application.status,
      archived: application.archivedAt !== null,
      deadline: application.deadline ? formatCalendarDate(application.deadline) : null,
      match: match.success && match.data.items.length > 0 ? matchScore(match.data) : null,
      score: application.score,
      hasUploadedResume: application.files.length > 0,
      agentApply: application.posting?.source === "NAUKRI",
      sentAt: application.sentAt,
      updatedAt: application.updatedAt,
    };
  });
  return sortRows(rows, sort).map(({ sentAt, updatedAt, ...row }): ApplicationRow => ({
    ...row,
    sent: sentAt ? formatShortDate(sentAt, now) : null,
    updated: updatedAgo(updatedAt, now),
    updatedAt: updatedAt.getTime(),
  }));
}

/** A saved posting that hasn't been scored yet: the board's Saved column (read-only). */
export type SavedRow = { id: string; company: string; title: string; place: string; saved: string; savedAt: number };

/** Saved postings with no application: newest first. Scoring one makes it an application in Scored. */
export async function loadSavedRows(now = new Date()): Promise<SavedRow[]> {
  const postings = await prisma.posting.findMany({
    where: { savedAt: { not: null }, dismissedAt: null, applicationId: null },
    orderBy: { savedAt: "desc" },
    select: { id: true, company: true, title: true, place: true, savedAt: true },
  });
  return postings.map(({ savedAt, ...posting }) => ({
    ...posting,
    company: posting.company.trim(),
    title: posting.title.trim() || "Untitled posting",
    place: posting.place.trim(),
    saved: updatedAgo(savedAt!, now),
    savedAt: savedAt!.getTime(),
  }));
}
