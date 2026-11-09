"use client";

import { useTrackSave } from "@/components/save-tracker";
import { Input } from "@/components/ui/input";
import { useAutosave } from "@/hooks/use-autosave";
import { publicationLink } from "@/lib/citation";
import { formatMonthYear, type CertificationItem, type ProfileData } from "@/lib/profile";

import { createCertification, removeCertification, reorderCertifications, restoreCertification, saveCertification } from "./actions";
import { EntryList } from "./entry-list";
import { MonthYearField } from "./month-year-field";
import type { UpdateProfile } from "./skills-section";

function CertificationForm({
  entry,
  onChange,
  autoFocus,
}: {
  entry: CertificationItem;
  onChange: (entry: CertificationItem) => void;
  autoFocus: boolean;
}) {
  const track = useTrackSave();
  const { flush } = useAutosave(entry, (value) => track(saveCertification(value)));
  const set = (change: Partial<CertificationItem>) => onChange({ ...entry, ...change });

  return (
    <div className="grid grid-cols-2 gap-[18px]" onBlur={flush}>
      <Input
        className="col-span-2"
        label="Name"
        placeholder="AWS Certified Developer – Associate"
        value={entry.name}
        onChange={(event) => set({ name: event.target.value })}
        autoFocus={autoFocus}
      />
      <Input
        className="col-span-2"
        label="Issuing organisation"
        placeholder="Amazon Web Services"
        value={entry.issuer}
        onChange={(event) => set({ issuer: event.target.value })}
      />
      <MonthYearField
        label="Issued"
        value={{ month: entry.issueMonth, year: entry.issueYear }}
        onChange={({ month, year }) => set({ issueMonth: month, issueYear: year })}
      />
      <MonthYearField
        label="Expires (optional)"
        value={{ month: entry.expiryMonth, year: entry.expiryYear }}
        onChange={({ month, year }) => set({ expiryMonth: month, expiryYear: year })}
      />
      <Input
        label="Credential ID (optional)"
        value={entry.credentialId}
        onChange={(event) => set({ credentialId: event.target.value })}
      />
      <Input
        label="Credential URL (optional)"
        placeholder="credly.com/badges/…"
        hint="On a PDF, the link can be clicked."
        value={entry.credentialUrl}
        onChange={(event) => set({ credentialUrl: event.target.value })}
        onBlur={() => {
          const credentialUrl = publicationLink(entry.credentialUrl);
          if (credentialUrl !== entry.credentialUrl) set({ credentialUrl });
        }}
      />
    </div>
  );
}

/** Licences and certifications: in the order set by hand; resumes show them as entered. */
export function CertificationsSection({ profile, update }: { profile: ProfileData; update: UpdateProfile }) {
  return (
    <EntryList
      items={profile.certifications}
      setItems={(change) => update((current) => ({ ...current, certifications: change(current.certifications) }))}
      addLabel="Add a certification"
      ordering={{ mode: "manual", save: (ids) => reorderCertifications({ ids }) }}
      summary={(entry) => ({
        title: entry.name.trim() || "New certification",
        subtitle: entry.issuer.trim(),
        meta: formatMonthYear(entry.issueYear, entry.issueMonth) ? `Issued ${formatMonthYear(entry.issueYear, entry.issueMonth)}` : undefined,
      })}
      create={() => createCertification({})}
      remove={(entry) => removeCertification({ id: entry.id })}
      restore={(entry) => restoreCertification(entry)}
      renderForm={(entry, { onChange, autoFocus }) => (
        <CertificationForm entry={entry} onChange={onChange} autoFocus={autoFocus} />
      )}
    />
  );
}
