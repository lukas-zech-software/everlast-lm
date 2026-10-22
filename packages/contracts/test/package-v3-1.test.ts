import { describe, expect, it } from "vitest";
import * as contracts from "../src/index.ts";
import {
  ChunkLocatorSchema,
  CopiedTextInputSchema,
  SourceDtoSchema,
  SourceMediaTypeSchema,
  UnifiedDocumentChunkSchema,
  mediaTypeForFileName,
  uuidv7,
} from "../src/index.ts";

/**
 * [009-multimodal-ingestion-sync] T003 — package 3.1 shared DTOs around the unchanged C-01 contract
 * (C-01, C-02, FR-SI-01, FR-SI-04, FR-SI-05; spec FR-004, FR-006, FR-009, FR-013).
 */

const v3 = contracts as unknown as Record<string, any>;
const SOURCE = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a01";
const ATTEMPT = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a09";
const CONNECTION = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a0c";

const legacyDto = {
  id: SOURCE,
  notebook_id: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a10",
  title: "Report.pdf",
  media_type: "application/pdf",
  status: "Ready",
  byte_size: 10,
  word_count: 2,
  revision: 1,
  error: null,
  created_at: "2026-10-22T10:00:00.000Z",
  updated_at: "2026-10-22T10:00:00.000Z",
};

describe("C-01 stays the exact existing strict contract (T003)", () => {
  it("V31-C01: page_span, time_span and dom_path remain the only locator variants; v1 chunks still parse", () => {
    expect(ChunkLocatorSchema.safeParse({ page_number: 2, physical_page: 2, start_offset: 0, end_offset: 5 }).success).toBe(true);
    expect(ChunkLocatorSchema.safeParse({ start_ms: 255000, end_ms: 262000 }).success).toBe(true);
    expect(ChunkLocatorSchema.safeParse({ selector: "section:nth-of-type(1)", start_offset: 0, end_offset: 4 }).success).toBe(true);
    // FR-SI-01: a rendered slide number is page metadata, never a new locator variant.
    expect(ChunkLocatorSchema.safeParse({ slide_number: 3, start_offset: 0, end_offset: 4 }).success).toBe(false);
    expect(ChunkLocatorSchema.safeParse({ page_number: 3, slide_number: 3, start_offset: 0, end_offset: 4 }).success).toBe(false);
  });

  it("V31-C02: display_time is derived view metadata and is rejected inside the strict time_span locator", () => {
    expect(ChunkLocatorSchema.safeParse({ start_ms: 255000, end_ms: 262000, display_time: "04:15" }).success).toBe(false);
    expect(ChunkLocatorSchema.safeParse({ start_ms: 255000.5, end_ms: 262000 }).success).toBe(false);
    expect(ChunkLocatorSchema.safeParse({ start_ms: 262000, end_ms: 255000 }).success).toBe(false);
    expect(ChunkLocatorSchema.safeParse({ start_ms: -1, end_ms: 5 }).success).toBe(false);
  });

  it("V31-C03: fresh replacement chunk IDs are UUIDv7 and the six-field revision-bearing chunk is unchanged", () => {
    const ids = new Set(Array.from({ length: 50 }, () => uuidv7()));
    expect(ids.size).toBe(50);
    const chunk = { chunk_id: uuidv7(), source_id: SOURCE, revision: 2, locator: { start_ms: 0, end_ms: 9000 }, token_count: 12, text: "We discussed the depot rollout." };
    expect(UnifiedDocumentChunkSchema.parse(chunk)).toEqual(chunk);
    expect(UnifiedDocumentChunkSchema.safeParse({ ...chunk, display_time: "00:00" }).success).toBe(false);
  });
});

describe("Display time for transcript/view DTOs (FR-SI-01, FR-SI-04, Gate v3.0 #1)", () => {
  it("V31-T01: formatDisplayTime floors minutes and zero-pads seconds", () => {
    expect(v3.formatDisplayTime(255000)).toBe("04:15");
    expect(v3.formatDisplayTime(0)).toBe("00:00");
    expect(v3.formatDisplayTime(59_999)).toBe("00:59");
    expect(v3.formatDisplayTime(600_000)).toBe("10:00");
    expect(v3.formatDisplayTime(7_265_000)).toBe("121:05");
    expect(() => v3.formatDisplayTime(-1)).toThrow();
    expect(() => v3.formatDisplayTime(1.5)).toThrow();
  });

  it("V31-T02: a transcript segment view must carry the display_time derived from start_ms", () => {
    const segment = { page_number: 18, start_ms: 255000, end_ms: 264000, display_time: "04:15", text: "The budget review moves to Thursday." };
    expect(v3.TranscriptSegmentViewSchema.safeParse(segment).success).toBe(true);
    expect(v3.TranscriptSegmentViewSchema.safeParse({ ...segment, display_time: "04:16" }).success).toBe(false);
    expect(v3.TranscriptSegmentViewSchema.safeParse({ ...segment, end_ms: 1 }).success).toBe(false);
  });
});

describe("Source titles: rename 1–200 vs copied text 100 (FR-SI-05, FR-SI-01; spec FR-009)", () => {
  const rename = (title: string) => v3.SourceRenameInputSchema.safeParse({ title });

  it("V31-R01: rename accepts 1 and 200 code points after trimming, rejects 0 and 201", () => {
    expect(rename("a").success).toBe(true);
    expect(rename("  a  ").success).toBe(true);
    expect(rename("x".repeat(200)).success).toBe(true);
    expect(rename("😀".repeat(200)).success).toBe(true); // 200 code points, 400 UTF-16 units
    expect(rename("").success).toBe(false);
    expect(rename("   \t\n").success).toBe(false);
    expect(rename("x".repeat(201)).success).toBe(false);
    expect(rename("😀".repeat(201)).success).toBe(false);
  });

  it("V31-R02: the rename result is trimmed, never truncated; unknown fields are rejected", () => {
    expect(v3.SourceRenameInputSchema.parse({ title: "  Q3 plan  " }).title).toBe("Q3 plan");
    expect(v3.SourceRenameInputSchema.safeParse({ title: "ok", media_type: "text/plain" }).success).toBe(false);
    expect(v3.MAX_SOURCE_TITLE_CODE_POINTS).toBe(200);
  });

  it("V31-R03: copied-text creation keeps its 100-code-point title limit", () => {
    expect(CopiedTextInputSchema.safeParse({ text: "body", title: "x".repeat(100) }).success).toBe(true);
    expect(CopiedTextInputSchema.safeParse({ text: "body", title: "x".repeat(101) }).success).toBe(false);
  });

  it("V31-R04: the public source DTO displays renamed 200-point titles but not 201", () => {
    expect(SourceDtoSchema.safeParse({ ...legacyDto, title: "x".repeat(200) }).success).toBe(true);
    expect(SourceDtoSchema.safeParse({ ...legacyDto, title: "x".repeat(201) }).success).toBe(false);
  });
});

describe("Media types and upload admission (FR-SI-01, FR-NM-03)", () => {
  it("V31-M01: uploads admit DOCX/PPTX/MP3/WAV/M4A in addition to v1 formats", () => {
    const upload = v3.uploadMediaTypeForFileName as (name: string) => string | null;
    expect(upload("Plan.docx")).toBe(v3.DOCX_MEDIA_TYPE);
    expect(upload("Deck.PPTX")).toBe(v3.PPTX_MEDIA_TYPE);
    expect(upload("Interview.mp3")).toBe("audio/mpeg");
    expect(upload("call.wav")).toBe("audio/wav");
    expect(upload("memo.m4a")).toBe("audio/mp4");
    expect(upload("Report.pdf")).toBe("application/pdf");
    expect(upload("notes.md")).toBe("text/markdown");
    expect(upload("tool.exe")).toBeNull();
    expect(upload("legacy.doc")).toBeNull();
    // v1 helper is unchanged for compatibility.
    expect(mediaTypeForFileName("Plan.docx")).toBeNull();
  });

  it("V31-M02: note_markdown stays a trusted server-side type that no upload can claim", () => {
    const upload = v3.uploadMediaTypeForFileName as (name: string) => string | null;
    expect(SourceMediaTypeSchema.safeParse("note_markdown").success).toBe(true);
    for (const name of ["x.note_markdown", "note_markdown", "x.notes"]) expect(upload(name)).toBeNull();
    expect(v3.UPLOADABLE_MEDIA_TYPES).not.toContain("note_markdown");
    expect(v3.UPLOADABLE_MEDIA_TYPES).not.toContain("copied_text");
  });

  it("V31-M03: the source media-type enum accepts every v3 type additively", () => {
    for (const type of [v3.DOCX_MEDIA_TYPE, v3.PPTX_MEDIA_TYPE, "audio/mpeg", "audio/wav", "audio/mp4", "text/html", "video_url"]) {
      expect(SourceMediaTypeSchema.safeParse(type).success, type).toBe(true);
    }
  });
});

describe("Linked import / sync envelopes (FR-SI-01, FR-SI-05; interfaces.md)", () => {
  it("V31-I01: each import kind accepts exactly its own fields", () => {
    const schema = v3.SourceImportRequestSchema;
    expect(schema.safeParse({ attempt_id: ATTEMPT, kind: "web", url: "https://news.example.test/a" }).success).toBe(true);
    expect(schema.safeParse({ attempt_id: ATTEMPT, kind: "video", url: "https://www.youtube.com/watch?v=abc123" }).success).toBe(true);
    expect(schema.safeParse({ attempt_id: ATTEMPT, kind: "drive", external_document_id: "1AbCdEfGhIjKlMnOp", connection_id: CONNECTION }).success).toBe(true);
    // Wrong-kind or extra fields are rejected rather than ignored.
    expect(schema.safeParse({ attempt_id: ATTEMPT, kind: "web", url: "https://a.test", connection_id: CONNECTION }).success).toBe(false);
    expect(schema.safeParse({ attempt_id: ATTEMPT, kind: "drive", url: "https://docs.google.com/document/d/x/edit" }).success).toBe(false);
    expect(schema.safeParse({ attempt_id: ATTEMPT, kind: "web", url: "ftp://a.test/x" }).success).toBe(false);
    expect(schema.safeParse({ attempt_id: ATTEMPT, kind: "web", url: "javascript:alert(1)" }).success).toBe(false);
    expect(schema.safeParse({ attempt_id: "not-a-uuid", kind: "web", url: "https://a.test" }).success).toBe(false);
    expect(schema.safeParse({ attempt_id: ATTEMPT, kind: "web", url: `https://a.test/${"x".repeat(2100)}` }).success).toBe(false);
  });

  it("V31-I02: 202 import/sync envelopes and the 409 overlap error have exact shapes and text", () => {
    expect(v3.SourceImportAcceptedSchema.safeParse({ source_id: SOURCE, operation_id: ATTEMPT, status: "Processing" }).success).toBe(true);
    expect(v3.SourceImportAcceptedSchema.safeParse({ source_id: SOURCE, operation_id: ATTEMPT, status: "Ready" }).success).toBe(false);
    expect(v3.SourceSyncAcceptedSchema.safeParse({ operation_id: ATTEMPT, source_id: SOURCE, committed_revision: 3 }).success).toBe(true);
    const err = new v3.SyncAlreadyInProgressError();
    expect(err.status).toBe(409);
    expect(err.code).toBe("SyncAlreadyInProgress");
    expect(err.message).toBe("Sync already in progress");
    expect(v3.WEB_EXTRACTION_FAILED_MESSAGE).toBe("Unable to extract content from URL");
    expect(v3.NO_TRANSCRIPT_MESSAGE).toBe("No transcript available for this video");
  });

  it("V31-I03: operation states are internal Queued→Running→Succeeded|Failed|Cancelled; progress substates are not source states", () => {
    expect(v3.SourceOperationStateSchema.options).toEqual(["Queued", "Running", "Succeeded", "Failed", "Cancelled"]);
    expect(v3.SourceProgressSchema.options).toEqual(["Fetching", "Transcribing", "Parsing", "Syncing"]);
    const op = {
      operation_id: ATTEMPT,
      source_id: SOURCE,
      kind: "sync",
      state: "Running",
      progress: "Fetching",
      committed_revision: 1,
      error: null,
      created_at: legacyDto.created_at,
      updated_at: legacyDto.updated_at,
    };
    expect(v3.SourceOperationDtoSchema.safeParse(op).success).toBe(true);
    expect(v3.SourceOperationDtoSchema.safeParse({ ...op, fencing_token: 4 }).success).toBe(false);
    expect(v3.SourceOperationDtoSchema.safeParse({ ...op, secret_ref: "x" }).success).toBe(false);
  });

  it("V31-I04: only Web URL and linked Drive sources are re-sync eligible", () => {
    expect(v3.isSyncEligible("web")).toBe(true);
    expect(v3.isSyncEligible("drive")).toBe(true);
    expect(v3.isSyncEligible("video")).toBe(false);
    expect(v3.isSyncEligible(null)).toBe(false);
  });

  it("V31-I05: Google Docs/Slides links resolve to an external document ID without generic scraping", () => {
    expect(v3.parseGoogleDocumentLink("https://docs.google.com/document/d/1AbC_dEf-123/edit#heading=h.1")).toEqual({ id: "1AbC_dEf-123", kind: "document" });
    expect(v3.parseGoogleDocumentLink("https://docs.google.com/presentation/d/9ZyX/edit")).toEqual({ id: "9ZyX", kind: "presentation" });
    expect(v3.parseGoogleDocumentLink("https://docs.google.com.evil.test/document/d/x/edit")).toBeNull();
    expect(v3.parseGoogleDocumentLink("https://example.test/document/d/x")).toBeNull();
  });
});

describe("Additive source DTO compatibility (FR-SI-01/05, C-01; interfaces.md latest-main compatibility)", () => {
  it("V31-D01: the legacy v1 source DTO still parses unchanged", () => {
    expect(SourceDtoSchema.parse(legacyDto)).toEqual(legacyDto);
  });

  it("V31-D02: v3 fields are additive: link kind, URLs, sync state, progress and last sync time", () => {
    const linked = {
      ...legacyDto,
      media_type: "text/html",
      link_kind: "web",
      external_url: "https://intranet.corp/roadmap",
      canonical_url: "https://intranet.corp/roadmap",
      progress: "Syncing",
      last_synced_at: "2026-10-22T11:00:00.000Z",
      sync: { operation_id: ATTEMPT, state: "Running" },
    };
    expect(SourceDtoSchema.safeParse(linked).success).toBe(true);
    expect(SourceDtoSchema.safeParse({ ...linked, progress: "ReSyncing" }).success).toBe(false);
    // ReSyncing/Syncing is an operation indicator, never a source eligibility state.
    expect(SourceDtoSchema.safeParse({ ...linked, status: "Syncing" }).success).toBe(false);
    expect(SourceDtoSchema.safeParse({ ...linked, delegated_token: "secret" }).success).toBe(false);
  });
});
