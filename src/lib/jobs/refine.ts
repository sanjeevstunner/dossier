import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { ChatRole, DocumentKind, VersionCause } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { refineChat, type ChatTurn } from "@/lib/ai/tasks";
import { addProfileUnit, profileUnits } from "@/lib/ai/tasks/refine-chat";
import { editsSchema, extractedOf, messagePartsSchema, putBack, reorder, type MessageParts, trimmedSchema, unitsSchema, type Trimmed, type Unit, type UnitEdit } from "@/lib/application-data";
import { describeTrim, fitResumeToPages, leaveOutUnitCut } from "@/lib/page-limit";
import { updateDocuments } from "@/lib/document-units";
import { withoutPrivateParts } from "@/lib/letter-frame";
import { prisma } from "@/lib/prisma";
import { loadFactTexts, loadProfile } from "@/lib/profile-data";
import { unitName } from "@/lib/unit-text";

import { defineJob } from "./runner";

/** The key of an application's refine requests, to find one again after a reload. */
export const refineJobKey = (applicationId: string) => `refine:${applicationId}`;

const unitRef = z.object({ document: z.enum(DocumentKind), unitId: z.string().min(1) });

/** What an earlier reply's edits replaced, so "undo that" can edit them back. Only the model sees it. */
function beforeEdits(value: unknown): string {
  const edits = editsSchema.safeParse(value);
  if (!edits.success || edits.data.length === 0) return "";
  return `\n[Before this reply's edits: ${JSON.stringify(edits.data.map(({ document, unitId, previousText }) => ({ document, unitId, previousText })))}]`;
}

/** "A, B and C" */
const listOf = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * Answers a message in the Refine with AI panel (E8-5, APP-7, APP-9): the
 * reply, the unit edits it asks for and a new letter tone, saved together
 * with the reply. An edit only lands on a unit that still reads as the model
 * saw it; the reply mentions any it left alone.
 */
export const refineJob = defineJob({
  type: "refine",
  input: z.object({
    applicationId: z.string().min(1),
    /** The user's message, saved before the job started. */
    messageId: z.string().min(1),
    request: z.string().min(1),
    /** The unit picked with "Ask AI", if any. */
    target: unitRef.nullable(),
    /** The document on screen. */
    viewing: z.enum(DocumentKind).nullable(),
  }),
  result: z.object({
    /** The AI's reply. */
    messageId: z.string(),
    /** The units it changed, to show them. */
    edited: z.array(unitRef),
  }),
  async run({ applicationId, messageId, request, target, viewing }, { step, signal }) {
    await step("Thinking");
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: { documents: true, messages: { orderBy: { createdAt: "asc" } } },
    });
    const unitsOf = (kind: DocumentKind): Unit[] => {
      const parsed = unitsSchema.safeParse(application.documents.find((document) => document.kind === kind)?.units);
      return parsed.success ? parsed.data : [];
    };
    const resume = unitsOf(DocumentKind.RESUME);
    const savedCuts = trimmedSchema.safeParse(application.documents.find((document) => document.kind === DocumentKind.RESUME)?.trimmed);
    const leftOut = savedCuts.success ? savedCuts.data : [];
    // The letter's sender and signature hold contact details, which never go to the model (E8-11).
    const letter = withoutPrivateParts(unitsOf(DocumentKind.COVER_LETTER));

    // The conversation before this message.
    const index = application.messages.findIndex((message) => message.id === messageId);
    const history: ChatTurn[] = application.messages.slice(0, index < 0 ? undefined : index).map((message) =>
      message.role === ChatRole.USER
        ? { role: "user", text: message.targetUnit ? `About ${message.targetUnit}: ${message.text}` : message.text }
        : { role: "assistant", text: `${message.text}${beforeEdits(message.edits)}` },
    );
    const targetUnit = target && unitsOf(target.document).find((unit) => unit.id === target.unitId);

    const [provider, options, profile, facts, themes] = await Promise.all([
      getAiProvider(),
      loadTaskOptions(),
      loadProfile(),
      loadFactTexts(applicationId),
      prisma.theme.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    const themeId = application.documents.find((document) => document.kind === DocumentKind.RESUME)?.themeId ?? null;
    const look = { themeId, themes, followThemeLayout: application.followThemeLayout, showPhoto: application.showPhoto };
    const { data, promptVersion } = await refineChat(
      provider,
      {
        request,
        history,
        target: targetUnit ? `${targetUnit.label} (${targetUnit.id})` : null,
        viewing,
        resume,
        letter,
        email: unitsOf(DocumentKind.EMAIL),
        leftOut,
        look,
        profile,
        extracted: extractedOf(application),
        tone: application.tone,
        facts,
        posting: application.postingText,
      },
      // The documents are in this language, so edits are too.
      { ...options, language: application.language || options.language, signal },
    );

    const result = await updateDocuments(applicationId, async (documents, tx) => {
      const resumeUnits = documents[DocumentKind.RESUME] ?? [];
      // Left-out parts the request asked for, put back as "Put back" would (E10-10), before the edits that tailor them.
      const restored = new Set<number>();
      for (const number of data.restore) if (putBack(resumeUnits, leftOut[number])) restored.add(number);
      // Profile entries it adds, kept like put-back parts so Undo leaves them out again.
      const all = profileUnits(profile, application.language || options.language);
      const added: Trimmed = [];
      for (const unitId of data.add) {
        if (!addProfileUnit(resumeUnits, all, unitId)) continue;
        const index = resumeUnits.findIndex((unit) => unit.id === unitId);
        added.push({ kind: "unit", unit: structuredClone(resumeUnits[index]), index });
      }

      const applied: UnitEdit[] = [];
      const leftAlone: string[] = [];
      for (const edit of data.edits) {
        const unit = documents[edit.document]?.find((entry) => entry.id === edit.unitId);
        if (!unit) continue;
        if (unit.text !== edit.previousText) {
          leftAlone.push(`the ${unitName(unit)}`);
          continue;
        }
        unit.text = edit.text;
        if (edit.unverified?.length) unit.unverified = edit.unverified;
        else delete unit.unverified;
        applied.push(edit);
      }

      // Parts the request took off, kept like "Leave out" keeps them (#217).
      const removed: Trimmed = [];
      for (const unitId of data.remove) {
        const index = resumeUnits.findIndex((unit) => unit.id === unitId);
        if (index < 0) continue;
        const [unit] = resumeUnits.splice(index, 1);
        removed.push({ kind: "unit", unit, index, byHand: true });
      }
      // How it looks: the skills line under entries, their order, and the application's layout, photo and theme.
      const lookNotes: string[] = [];
      const before: MessageParts["before"] = { order: null, skills: [], app: null };
      for (const { unitId, show } of data.look?.skills ?? []) {
        const unit = resumeUnits.find((entry) => entry.id === unitId);
        if (!unit) continue;
        before.skills.push({ unitId, hidden: unit.hideSkills === true });
        if (show) delete unit.hideSkills;
        else unit.hideSkills = true;
        lookNotes.push(`${show ? "Showed" : "Hid"} the skills under the ${unitName(unit)}.`);
      }
      if (data.look?.order) {
        const was = resumeUnits.map((unit) => unit.id);
        reorder(resumeUnits, data.look.order);
        if (resumeUnits.some((unit, index) => unit.id !== was[index])) {
          before.order = was;
          lookNotes.push("Changed the order.");
        }
      }
      const { sidebar = null, photo = null, themeId: newTheme = null } = data.look ?? {};
      if (sidebar !== null || photo !== null || newTheme) {
        before.app = { followThemeLayout: application.followThemeLayout, showPhoto: application.showPhoto, themeId };
        await tx.application.update({
          where: { id: applicationId },
          data: { ...(sidebar !== null && { followThemeLayout: sidebar }), ...(photo !== null && { showPhoto: photo }) },
        });
        if (sidebar !== null) lookNotes.push(sidebar ? "Switched to the theme's layout with its sidebar." : "Switched to a single column.");
        if (photo !== null) lookNotes.push(photo ? "Turned the photo on." : "Turned the photo off.");
        if (newTheme) lookNotes.push(`Switched to the ${themes.find((theme) => theme.id === newTheme)?.name} theme.`);
      }
      const looked = before.order !== null || before.skills.length > 0 || before.app !== null;

      if (data.tone) await tx.application.update({ where: { id: applicationId }, data: { tone: data.tone } });

      // What actually came back and went off, in the reply, so a later "undo that" knows (and the candidate sees it).
      const cutName = (cut: Trimmed[number]) => `the ${cut.kind === "unit" ? unitName(cut.unit) : `${cut.label}'s bullets`}`;
      const back = [...restored].map((number) => cutName(leftOut[number]));
      const nothing = data.attempted && leftAlone.length === 0 && applied.length + restored.size + added.length + removed.length === 0 && !data.tone && !data.fit && !looked;
      const note = [
        added.length > 0 && ` Added ${listOf(added.map(cutName))}.`,
        back.length > 0 && ` Put back ${listOf(back)}.`,
        removed.length > 0 && ` Left out ${listOf(removed.map(cutName))}.`,
        ...lookNotes.map((line) => ` ${line}`),
        nothing && " That didn't go through, so nothing on your documents changed. Try asking again, naming the part.",
        leftAlone.length > 0 && ` I left ${listOf(leftAlone)} as ${leftAlone.length === 1 ? "it is: it" : "they are: they"} changed while I was working.`,
      ]
        .filter(Boolean)
        .join("");
      const reply = await tx.chatMessage.create({
        data: {
          applicationId,
          role: ChatRole.AI,
          text: `${data.reply}${note}`,
          ...(applied.length > 0 ? { edits: applied } : {}),
          ...(restored.size + added.length + removed.length > 0 || looked
            ? { parts: { restored: [...[...restored].map((number) => leftOut[number]), ...added], cut: removed, ...(looked && { before }) } }
            : {}),
          previousTone: data.tone ? application.tone : null,
          writtenWith: promptVersion,
        },
        select: { id: true, text: true, parts: true },
      });
      const edited = applied.map(({ document, unitId }) => ({ document, unitId }));
      for (const item of [...[...restored].map((number) => leftOut[number]), ...added]) {
        const unitId = item.kind === "unit" ? item.unit.id : item.unitId;
        if (!edited.some((entry) => entry.unitId === unitId)) edited.push({ document: DocumentKind.RESUME, unitId });
      }
      const gone = new Set(removed.map((cut) => (cut.kind === "unit" ? cut.unit.id : "")));
      return { reply, edited: edited.filter((entry) => !gone.has(entry.unitId)), restored, removed, newTheme };
    }, { version: { cause: VersionCause.REFINED, detail: request } });

    // The theme is on the documents, so it's written after them, like the left-out list.
    if (result.newTheme) {
      await prisma.document.updateMany({
        where: { applicationId, kind: { in: [DocumentKind.RESUME, DocumentKind.COVER_LETTER] } },
        data: { themeId: result.newTheme },
      });
    }

    // Written after the units, as "Put back" and "Leave out" do: updateDocuments checks the document wasn't changed meanwhile.
    const trimmed: Trimmed = [...leftOut.filter((_, number) => !result.restored.has(number)), ...result.removed];
    if (result.restored.size > 0 || result.removed.length > 0) {
      await prisma.document.updateMany({
        where: { applicationId, kind: DocumentKind.RESUME },
        data: { trimmed: trimmed.length > 0 ? trimmed : Prisma.DbNull },
      });
    }

    // "Fit it on two pages": measured in the real PDF, cutting in the model's order only until it fits.
    if (data.fit) {
      await step("Fitting the pages");
      const order = data.fit.cutInOrder;
      const fitted = await fitResumeToPages(applicationId, profile, data.fit.pages, undefined, {
        earlier: trimmed,
        next: (units) => {
          const unitId = order.find((id) => units.some((unit) => unit.id === id));
          return unitId ? leaveOutUnitCut(units, unitId) : null;
        },
      });
      const lines = describeTrim(fitted.trimmed, profile, fitted.fits, data.fit.pages);
      if (lines.length > 0) {
        const cut = new Set(fitted.trimmed.map((entry) => (entry.kind === "unit" ? entry.unit.id : "")));
        const parts = messagePartsSchema.safeParse(result.reply.parts);
        await prisma.chatMessage.update({
          where: { id: result.reply.id },
          data: {
            text: `${result.reply.text} ${lines.join(". ")}.`,
            parts: { ...(parts.success ? parts.data : { restored: [] }), cut: [...(parts.success ? parts.data.cut : []), ...fitted.trimmed] },
          },
        });
        result.edited = result.edited.filter((entry) => !cut.has(entry.unitId));
      }
    }
    return { messageId: result.reply.id, edited: result.edited };
  },
});

export type RefineResult = z.infer<typeof refineJob.result>;
