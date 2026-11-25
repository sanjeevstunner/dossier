/** Marks an application the Naukri sync brought in, not one made in Dossier. */
export function NaukriBadge() {
  return (
    <span title="Fetched from your Naukri applications" className="ml-2 rounded-[6px] bg-selected px-1.5 text-xs font-medium text-primary-text">
      Naukri
    </span>
  );
}
