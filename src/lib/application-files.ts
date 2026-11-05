import { DocumentKind } from "@/generated/prisma/enums";

// The resume and cover letter an application was sent with, uploaded as the
// user sent them (PDF or .docx) and kept unchanged. They stand in for the
// generated documents (on their tabs, as the email's attachments, in Gmail
// and the PDF zip) until the AI writes one.

/** The largest file an application takes, the same as the profile import's. */
export const FILE_MAX_BYTES = 5 * 1024 * 1024;

export const PDF_TYPE = "application/pdf";
export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** What the file pickers accept. */
export const FILE_ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const FILE_MESSAGES = {
  tooBig: "That file is over 5 MB. Export it again without images.",
  wrongType: "Choose a PDF or a Word (.docx) file.",
};

/** The kinds of document a file can be, by the `kind` in their URL. */
export const FILE_KINDS = { resume: DocumentKind.RESUME, letter: DocumentKind.COVER_LETTER } as const;
export type FileKind = keyof typeof FILE_KINDS;

export const fileKindOf = (kind: DocumentKind): FileKind => (kind === DocumentKind.COVER_LETTER ? "letter" : "resume");

/** An uploaded file as the application page knows it, without its bytes. */
export type FileInfo = { name: string; type: string; size: number };

/** Where the file is served: inline, or as a download. */
export const fileHref = (applicationId: string, kind: FileKind, download = false) =>
  `/api/applications/${applicationId}/files/${kind}${download ? "?download" : ""}`;

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, index) => bytes[index] === byte);

/** The media type of a PDF or .docx by its first bytes, or null for anything else. */
export function fileType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return PDF_TYPE; // %PDF-
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return DOCX_TYPE; // PK: .docx is a zip
  return null;
}

/** A file name that's safe in a header and still says what it is. */
export function cleanFileName(name: string, type: string): string {
  const extension = type === PDF_TYPE ? ".pdf" : ".docx";
  const base = name
    .replace(/[\x00-\x1F\x7F"\\/]/g, "")
    .trim()
    .replace(/\.(pdf|docx)$/i, "")
    .slice(0, 150);
  return `${base || "Document"}${extension}`;
}

/**
 * Sends a file to an application from the browser; the error is written for
 * the user. A route handler takes it, since Server Actions take at most 1 MB.
 */
export async function uploadFile(applicationId: string, kind: FileKind, file: File): Promise<{ ok: true } | { ok: false; error: string }> {
  if (file.size > FILE_MAX_BYTES) return { ok: false, error: FILE_MESSAGES.tooBig };
  try {
    const response = await fetch(`/api/applications/${applicationId}/files/${kind}`, {
      method: "POST",
      headers: { "x-file-name": encodeURIComponent(file.name) },
      body: file,
    });
    if (response.ok) return { ok: true };
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "That file didn't upload. Try again." };
  } catch {
    return { ok: false, error: "That file didn't upload. Check your connection and try again." };
  }
}
