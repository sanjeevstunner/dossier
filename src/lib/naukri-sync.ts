import "server-only";

import { ApplicationStatus } from "@/generated/prisma/enums";
import { credentialsFor, loadJobSearchConfig, requestContext } from "@/lib/job-search/config";
import { JobSearchError } from "@/lib/job-search/errors";
import { naukriApplications, type NaukriApplication } from "@/lib/job-search/naukri";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { DEFAULT_NAUKRI_STATUS_MAP, statusFromNaukri, type NaukriStatusMap } from "@/lib/naukri-status";
import { applyStatusChange } from "@/lib/status-changes";

// Naukri's applied-jobs history, kept in Applications. Naukri is the source of
// truth for status: the sync creates what Dossier doesn't have and moves the
// status of what it does (its own too, matched by Naukri's job id). Nothing
// else on an application is touched.

export const SYNCED_FROM = "NAUKRI";

export type SyncResult = { created: number; updated: number; total: number; unmapped: string[] };

export async function applyNaukriApplications(found: readonly NaukriApplication[], now = new Date(), map: NaukriStatusMap = DEFAULT_NAUKRI_STATUS_MAP): Promise<SyncResult> {
  const ids = found.map((entry) => entry.jobId);
  const [synced, viaPosting] = await Promise.all([
    prisma.application.findMany({ where: { syncedFrom: SYNCED_FROM, externalId: { in: ids } }, select: { id: true, status: true, externalId: true } }),
    prisma.application.findMany({ where: { posting: { source: "NAUKRI", externalId: { in: ids } } }, select: { id: true, status: true, posting: { select: { externalId: true } } } }),
  ]);
  const known = new Map<string, { id: string; status: ApplicationStatus }>();
  for (const row of synced) known.set(row.externalId!, row);
  for (const row of viaPosting) known.set(row.posting!.externalId, row);

  const result: SyncResult = { created: 0, updated: 0, total: found.length, unmapped: [] };
  for (const entry of found) {
    const word = entry.statuses.at(-1)?.value.trim();
    const mapped = statusFromNaukri(word, map);
    // A word nobody listed is reported, and treated as sent.
    if (!mapped && word && !result.unmapped.includes(word) && result.unmapped.length < 20) result.unmapped.push(word);
    const status = mapped ?? ApplicationStatus.SENT;
    const existing = known.get(entry.jobId);
    if (existing) {
      // "Applied" is all Naukri knows about an application moved further by hand, so it doesn't pull it back.
      if (status === existing.status) {
        // Already there (moved by hand or by an earlier sync): the Notes tab still gets Naukri's word on that move.
        if (word) {
          const event = await prisma.statusEvent.findFirst({ where: { applicationId: existing.id, to: status }, orderBy: { at: "desc" }, select: { id: true, naukriStatus: true } });
          if (event && !event.naukriStatus) await prisma.statusEvent.update({ where: { id: event.id }, data: { naukriStatus: word } });
        }
        continue;
      }
      if (status === ApplicationStatus.SENT) continue;
      if ((await applyStatusChange(prisma, existing.id, status, now, word)).outcome === "changed") result.updated++;
      continue;
    }
    const sentAt = entry.statuses.find((item) => item.at)?.at ?? now;
    const created = await prisma.application
      .create({
        data: {
          syncedFrom: SYNCED_FROM,
          externalId: entry.jobId,
          title: entry.title,
          role: entry.title,
          company: entry.company,
          location: entry.location,
          postingUrl: `https://www.naukri.com/job-listings-${entry.jobId}`,
        },
        select: { id: true },
      })
      // Another sync made it first.
      .catch((error: { code?: string }) => (error.code === "P2002" ? null : Promise.reject(error)));
    if (!created) continue;
    result.created++;
    // Through the status module, so the Notes tab shows the move with Naukri's word for it.
    await applyStatusChange(prisma, created.id, status, now, word);
    await prisma.application.update({ where: { id: created.id }, data: { sentAt } });
  }
  return result;
}

const globalForSync = globalThis as unknown as { naukriSyncRunning?: boolean; naukriSyncTimer?: ReturnType<typeof setTimeout> };

/**
 * One sync with the fetch settings (days back, most applications). Returns null
 * when one is already running. A failure is kept in Settings for the screen and
 * thrown; the next success clears it.
 */
export async function syncNaukriApplications(): Promise<SyncResult | null> {
  if (globalForSync.naukriSyncRunning) return null;
  globalForSync.naukriSyncRunning = true;
  try {
    const settings = await loadSettings();
    const credentials = credentialsFor(await loadJobSearchConfig(), "NAUKRI");
    const found = await naukriApplications(credentials, { days: settings.naukriSyncDays, limit: settings.naukriSyncLimit }, requestContext("NAUKRI"));
    const result = await applyNaukriApplications(found, new Date(), settings.naukriStatusMap);
    await saveSettings({ naukriLastSyncAt: new Date().toISOString(), naukriSyncProblem: null, naukriUnmappedWords: result.unmapped });
    return result;
  } catch (error) {
    logServerError("naukri sync", error);
    const problem = error instanceof JobSearchError ? error.message : "The sync with Naukri failed.";
    await saveSettings({ naukriSyncProblem: problem }).catch(() => {});
    throw error;
  } finally {
    globalForSync.naukriSyncRunning = false;
  }
}

/** Starts the timer, once per process: a sync at start and then every `naukriSyncHours`, while the setting is on. */
export function startNaukriSchedule(): void {
  if (globalForSync.naukriSyncTimer) return;
  const schedule = async () => {
    const settings = await loadSettings().catch(() => null);
    const hours = settings?.naukriSyncHours ?? 6;
    globalForSync.naukriSyncTimer = setTimeout(() => {
      void loadSettings()
        .then((current) => (current.naukriSync ? syncNaukriApplications() : null))
        .catch(() => {})
        .finally(() => void schedule());
    }, hours * 3_600_000);
    globalForSync.naukriSyncTimer.unref?.();
  };
  // A first run shortly after start, so a restart doesn't wait hours.
  void loadSettings()
    .then((settings) => (settings.naukriSync ? syncNaukriApplications() : null))
    .catch(() => {});
  void schedule();
}
