import type { Metadata } from "next";

import { listSummary, resolveListParams, statusesIn } from "@/lib/applications-list";
import { loadApplicationRows, loadSavedRows } from "@/lib/applications-data";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";

import { ApplicationsScreen } from "./applications-screen";

export const metadata: Metadata = { title: "Applications" };

/** Every application, on a board or in a table, with search and filters (PRD §6.6). */
export default async function ApplicationsPage({ searchParams }: PageProps<"/applications">) {
  // The URL wins; without it, the view, filter and sort last used (LST-7).
  const params = resolveListParams(await searchParams, await loadSettings());

  const [all, archived, savedAll] = await Promise.all([
    loadApplicationRows({ archived: params.archived, sort: params.sort }),
    prisma.application.count({ where: { archivedAt: { not: null }, awaitingReview: false } }),
    loadSavedRows(),
  ]);
  const q = params.q.toLocaleLowerCase();
  // Saved postings are in progress, so they show on the board under All and In progress.
  const saved = params.filter === "closed" ? [] : savedAll.filter((row) => !q || `${row.company} ${row.title}`.toLocaleLowerCase().includes(q));
  const found = q ? all.filter((row) => `${row.company} ${row.role}`.toLocaleLowerCase().includes(q)) : all;
  const counts = {
    all: all.length,
    active: all.filter((row) => statusesIn("active").includes(row.status)).length,
    closed: all.filter((row) => statusesIn("closed").includes(row.status)).length,
  };
  const current = all.filter((row) => !row.archived);

  return (
    <ApplicationsScreen
      params={params}
      saved={saved}
      rows={found.filter((row) => statusesIn(params.filter).includes(row.status))}
      counts={counts}
      summary={listSummary(current.map((row) => row.status))}
      empty={current.length === 0 && all.length === 0 && archived === 0 && savedAll.length === 0}
      archivedCount={archived}
    />
  );
}
