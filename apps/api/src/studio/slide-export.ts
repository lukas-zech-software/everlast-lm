import {
  buildSlideDeckOoxmlEntries,
  buildSlideDeckPdfBytes,
  SlideDeckExportRequestSchema,
  StudioParamsError,
  StudioSlideDeckPayloadSchema,
  type StudioSlideDeckPayload,
} from "@everlast/contracts";
import { writeOoxmlZip } from "./ooxml-zip.ts";

/**
 * [015-studio-visuals-presentations] T012 — Slide Deck `.pptx` & `.pdf` export adapter
 * (`FR-ST-16`, `D8/DEV-02`, `NFR-SEC-02`, `Gate v4.0 #3`).
 */

export interface SlideDeckExportResult {
  contentType: string;
  filename: string;
  bytes: Uint8Array;
}

export function exportSlideDeckArtifact(input: {
  artifactId: string;
  title: string;
  payload: StudioSlideDeckPayload;
  body: unknown;
}): Promise<SlideDeckExportResult> {
  const reqParsed = SlideDeckExportRequestSchema.safeParse(input.body);
  if (!reqParsed.success) {
    return Promise.reject(
      new StudioParamsError(reqParsed.error.issues.map((i) => i.message).join("; ")),
    );
  }
  const payloadParsed = StudioSlideDeckPayloadSchema.safeParse(input.payload);
  if (!payloadParsed.success) {
    return Promise.reject(
      new StudioParamsError(payloadParsed.error.issues.map((i) => i.message).join("; ")),
    );
  }

  const safePrefix =
    input.artifactId
      .slice(0, 8)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "") || "deck";
  const format = reqParsed.data.format;

  if (format === "pptx") {
    const entries = buildSlideDeckOoxmlEntries(input.title, payloadParsed.data);
    return Promise.resolve({
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      filename: `slide-deck-${safePrefix}.pptx`,
      bytes: new Uint8Array(writeOoxmlZip(entries)),
    });
  }

  return Promise.resolve({
    contentType: "application/pdf",
    filename: `slide-deck-${safePrefix}.pdf`,
    bytes: buildSlideDeckPdfBytes(input.title, payloadParsed.data),
  });
}
