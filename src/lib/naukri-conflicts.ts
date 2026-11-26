import "server-only";

import { ApplicationStatus } from "@/generated/prisma/enums";
import { normalizeNaukriWord, statusFromNaukri, type NaukriStatusMap } from "@/lib/naukri-status";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { applyStatusChange } from "@/lib/status-changes";

// Where Naukri and an application the user moved disagree. Naukri's word is
// kept on the application (`naukriWord`); a conflict is shown until the user
// decides, once per word (`naukriResolvedWord`).

export type NaukriConflict = {
  id: string;
  company: string;
  title: string;
  status: ApplicationStatus;
  /** When the application got its current status, if it has been moved. */
  statusSince: Date | null;
  /** Naukri's own word, and the status it maps to. */
  word: string;
  naukriStatus: ApplicationStatus;
};

/** What a word maps to; a word nobody listed counts as sent, as in the sync. */
export const naukriTarget = (word: string, map: NaukriStatusMap): ApplicationStatus => statusFromNaukri(word, map) ?? ApplicationStatus.SENT;

export const isResolved = (word: string, resolved: string | null): boolean => !!resolved && normalizeNaukriWord(word) === normalizeNaukriWord(resolved);

/** For each application, whether its latest status move was the user's (no Naukri word on it) and when it was made. */
export async function latestMoves(ids: string[]): Promise<Map<string, { byUser: boolean; at: Date }>> {
  const events = await prisma.statusEvent.findMany({
    where: { applicationId: { in: ids } },
    orderBy: { at: "desc" },
    distinct: ["applicationId"],
    select: { applicationId: true, naukriStatus: true, at: true },
  });
  return new Map(events.map((event) => [event.applicationId, { byUser: !event.naukriStatus, at: event.at }]));
}

/** Applications whose status the user set and Naukri's word disagrees with, that nobody has decided yet. */
export async function loadConflicts(map?: NaukriStatusMap): Promise<NaukriConflict[]> {
  const statusMap = map ?? (await loadSettings()).naukriStatusMap;
  const rows = await prisma.application.findMany({
    where: { naukriWord: { not: null }, archivedAt: null },
    select: { id: true, company: true, title: true, role: true, status: true, naukriWord: true, naukriResolvedWord: true },
    orderBy: { updatedAt: "desc" },
  });
  const differing = rows.filter((row) => naukriTarget(row.naukriWord!, statusMap) !== row.status && !isResolved(row.naukriWord!, row.naukriResolvedWord));
  const moves = await latestMoves(differing.map((row) => row.id));
  return differing.flatMap((row) => {
    const move = moves.get(row.id);
    // Moved last by the sync, or never moved by anyone: Naukri's word simply applies.
    if (move && !move.byUser) return [];
    return [{ id: row.id, company: row.company, title: row.role || row.title, status: row.status, statusSince: move?.at ?? null, word: row.naukriWord!, naukriStatus: naukriTarget(row.naukriWord!, statusMap) }];
  });
}

export type ConflictChoice = "naukri" | "dossier";

/** Takes Naukri's status ("naukri") or keeps the application as it is ("dossier"); either way this word isn't asked about again. */
export async function resolveConflict(id: string, choice: ConflictChoice, map?: NaukriStatusMap, now = new Date()): Promise<boolean> {
  const application = await prisma.application.findUnique({ where: { id }, select: { naukriWord: true } });
  const word = application?.naukriWord;
  if (!word) return false;
  if (choice === "naukri") await applyStatusChange(prisma, id, naukriTarget(word, map ?? (await loadSettings()).naukriStatusMap), now, word);
  await prisma.application.update({ where: { id }, data: { naukriResolvedWord: word } });
  return true;
}

export async function resolveAllConflicts(choice: ConflictChoice): Promise<number> {
  const map = (await loadSettings()).naukriStatusMap;
  let done = 0;
  for (const conflict of await loadConflicts(map)) if (await resolveConflict(conflict.id, choice, map)) done++;
  return done;
}
