import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getSession } from "@/lib/auth/session";
import { DOCX_TYPE, FILE_MAX_BYTES, FILE_MESSAGES, PDF_TYPE } from "@/lib/application-files";
import { createTestClient, resetDatabase } from "@/test/db";
import { docxWith, pdfWith } from "@/test/resume-files";

import { DELETE, GET, POST } from "./route";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const prisma = () => db.client!;

const call = (handler: typeof GET, method: string, { id = "app-1", kind = "resume", body, headers = {}, query = "" }: { id?: string; kind?: string; body?: BodyInit; headers?: Record<string, string>; query?: string } = {}) =>
  handler(
    new NextRequest(`http://localhost:3000/api/applications/${id}/files/${kind}${query}`, {
      method,
      body,
      headers: { origin: "http://localhost:3000", host: "localhost:3000", ...headers },
    }),
    { params: Promise.resolve({ id, kind }) },
  );

const pdf = new Uint8Array(pdfWith(["Jane Doe", "Senior Product Designer"]));

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().application.create({ data: { id: "app-1", title: "Designer · Ledgerly" } });
  vi.mocked(getSession).mockResolvedValue({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
});
afterAll(() => prisma().$disconnect());

describe("/api/applications/[id]/files/[kind]", () => {
  it("keeps an uploaded PDF as it is, and serves it inline in a sandbox", async () => {
    const posted = await call(POST, "POST", { body: pdf, headers: { "x-file-name": encodeURIComponent("Jane – Resume.pdf") } });
    expect(posted.status).toBe(200);
    expect(await posted.json()).toEqual({ name: "Jane – Resume.pdf" });

    const served = await call(GET, "GET");
    expect(served.headers.get("content-type")).toBe(PDF_TYPE);
    expect(served.headers.get("content-disposition")).toMatch(/^inline; /);
    expect(served.headers.get("content-security-policy")).toBe("sandbox");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(pdf);

    const downloaded = await call(GET, "GET", { query: "?download" });
    expect(downloaded.headers.get("content-disposition")).toMatch(/^attachment; /);
  });

  it("serves a .docx as a download, and replaces the one before", async () => {
    await call(POST, "POST", { kind: "letter", body: pdf, headers: { "x-file-name": "letter.pdf" } });
    await call(POST, "POST", { kind: "letter", body: new Uint8Array(docxWith(["Dear team,"])), headers: { "x-file-name": "Letter.docx" } });
    const files = await prisma().applicationFile.findMany();
    expect(files).toEqual([expect.objectContaining({ kind: "COVER_LETTER", name: "Letter.docx", type: DOCX_TYPE })]);
    expect((await call(GET, "GET", { kind: "letter" })).headers.get("content-disposition")).toMatch(/^attachment; /);
  });

  it("refuses anything but a PDF or .docx, and files over 5 MB", async () => {
    const wrong = await call(POST, "POST", { body: "just text", headers: { "x-file-name": "notes.txt" } });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: FILE_MESSAGES.wrongType });
    const big = await call(POST, "POST", { body: new Uint8Array(FILE_MAX_BYTES + 1) });
    expect(big.status).toBe(413);
    expect(await prisma().applicationFile.count()).toBe(0);
  });

  it("removes it", async () => {
    await call(POST, "POST", { body: pdf });
    expect((await call(DELETE, "DELETE")).status).toBe(204);
    expect((await call(GET, "GET")).status).toBe(404);
  });

  it("says there's no such file for another kind or application", async () => {
    expect((await call(POST, "POST", { kind: "email", body: pdf })).status).toBe(404);
    expect((await call(POST, "POST", { id: "gone", body: pdf })).status).toBe(404);
  });

  it("needs a session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await call(GET, "GET")).status).toBe(401);
  });
});
