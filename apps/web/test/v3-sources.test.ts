import { describe, expect, it } from "vitest";
import * as contracts from "@everlast/contracts";
import * as web from "../src/lib/v3-sources.ts";

/** [009-multimodal-ingestion-sync] T017 — SPA mirrors stay identical to the shared package 3.1 helpers (FR-SI-01/04/05). */

describe("v3 client helpers mirror contracts", () => {
  it("V3-WEB-01: display time, link parsing, sync eligibility and rename limits are identical", () => {
    for (const ms of [0, 999, 59_999, 255_000, 600_000, 7_265_000]) expect(web.formatDisplayTime(ms)).toBe(contracts.formatDisplayTime(ms));
    for (const link of ["https://docs.google.com/document/d/1Ab_c-9/edit", "https://docs.google.com/presentation/d/x/", "https://docs.google.com.evil/document/d/x", "nope"]) {
      expect(web.parseGoogleDocumentLink(link)).toEqual(contracts.parseGoogleDocumentLink(link));
    }
    for (const k of ["web", "drive", "video", null]) expect(web.isSyncEligible(k)).toBe(contracts.isSyncEligible(k));
    for (const t of ["", " ", "a", "x".repeat(200), "x".repeat(201), "😀".repeat(200)]) {
      expect(web.validRenameTitle(t)).toBe(contracts.SourceRenameInputSchema.safeParse({ title: t }).success);
    }
  });

  it("V3-WEB-02: every uploadable media type and v3 link kind maps to a distinct format icon", () => {
    expect(web.sourceKind({ media_type: contracts.DOCX_MEDIA_TYPE })).toBe("docx");
    expect(web.sourceKind({ media_type: contracts.PPTX_MEDIA_TYPE })).toBe("pptx");
    for (const t of contracts.AUDIO_MEDIA_TYPES) expect(web.sourceKind({ media_type: t })).toBe("audio");
    expect(web.sourceKind({ media_type: "text/html", link_kind: "web" })).toBe("web");
    expect(web.sourceKind({ media_type: "application/pdf", link_kind: "web" })).toBe("web");
    expect(web.sourceKind({ media_type: "video_url", link_kind: "video" })).toBe("video");
    for (const type of contracts.UPLOADABLE_MEDIA_TYPES) expect(web.UPLOAD_ACCEPT).toContain(type);
  });
});
