import { NextResponse } from "next/server";

import { heldPdf, pdfDownload } from "@/lib/pdf/downloads";
import { route } from "@/lib/route";

const GONE = "That PDF isn't here any more. Download it again.";

/** Hands over a PDF that `POST /api/pdf` rendered and held for a few minutes. */
export const GET = route<RouteContext<"/api/pdf/[id]">>(async (request, { params }) => {
  const held = heldPdf((await params).id);
  if (!held) return NextResponse.json({ error: GONE }, { status: 404 });
  const download = pdfDownload(held.pdf, held.fileName);
  // `?inline` shows it in a frame, as the resume check before an easy apply does.
  if (request.nextUrl.searchParams.has("inline")) download.headers.set("content-disposition", download.headers.get("content-disposition")!.replace(/^attachment/, "inline"));
  return download;
});
