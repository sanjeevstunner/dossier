import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { cleanFileName, FILE_KINDS, FILE_MAX_BYTES, FILE_MESSAGES, fileType, PDF_TYPE } from "@/lib/application-files";
import { contentDisposition } from "@/lib/file-name";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/route";

type Context = RouteContext<"/api/applications/[id]/files/[kind]">;

const notFound = () => NextResponse.json({ error: "There's no such file." }, { status: 404 });

/** The application and kind the URL names, or null when either doesn't exist. */
async function target({ params }: Context) {
  const { id, kind } = await params;
  if (!Object.hasOwn(FILE_KINDS, kind)) return null;
  const application = await prisma.application.findUnique({ where: { id }, select: { id: true } });
  return application ? { applicationId: application.id, kind: FILE_KINDS[kind as keyof typeof FILE_KINDS] } : null;
}

/**
 * The resume or cover letter the user uploaded for an application: inline
 * for a PDF, so its tab can show it, and as a download for a .docx or with
 * `?download`. Sandboxed, since it's whatever the user uploaded.
 */
export const GET = route<Context>(async (request, context) => {
  const found = await target(context);
  const file = found && (await prisma.applicationFile.findUnique({ where: { applicationId_kind: found } }));
  if (!file) return notFound();
  const download = request.nextUrl.searchParams.has("download") || file.type !== PDF_TYPE;
  const disposition = contentDisposition(file.name);
  return new Response(Buffer.from(file.data), {
    headers: {
      "content-type": file.type,
      "content-disposition": download ? disposition : disposition.replace(/^attachment/, "inline"),
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    },
  });
});

/**
 * Uploads it, sent as the request body with its name in `x-file-name`,
 * replacing the one before. Only PDF and .docx, by their first bytes.
 */
export const POST = route<Context>(async (request, context) => {
  if (Number(request.headers.get("content-length") ?? 0) > FILE_MAX_BYTES) {
    return NextResponse.json({ error: FILE_MESSAGES.tooBig }, { status: 413 });
  }
  const found = await target(context);
  if (!found) return notFound();
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > FILE_MAX_BYTES) return NextResponse.json({ error: FILE_MESSAGES.tooBig }, { status: 413 });
  const type = fileType(bytes);
  if (!type) return NextResponse.json({ error: FILE_MESSAGES.wrongType }, { status: 400 });

  let name = "";
  try {
    name = decodeURIComponent(request.headers.get("x-file-name") ?? "");
  } catch {
    // A name that doesn't decode gets the default.
  }
  const file = { name: cleanFileName(name, type), type, size: bytes.length, data: Buffer.from(bytes) };
  await prisma.applicationFile.upsert({
    where: { applicationId_kind: found },
    create: { ...found, ...file },
    update: { ...file, createdAt: new Date() },
  });
  revalidatePath(`/applications/${found.applicationId}`);
  return NextResponse.json({ name: file.name });
});

/** Removes it. */
export const DELETE = route<Context>(async (_request, context) => {
  const found = await target(context);
  if (!found) return notFound();
  await prisma.applicationFile.deleteMany({ where: found });
  revalidatePath(`/applications/${found.applicationId}`);
  return new Response(null, { status: 204 });
});
