import { describe, expect, it } from "vitest";
import {
  buildSlideDeckOoxmlEntries,
  buildSlideDeckPdfBytes,
  CreateStudioJobRequestSchema,
  enforceSlideBulletLimit,
  InfographicExportRequestSchema,
  InfographicStyleSchema,
  renderInfographicSvg,
  SLIDE_COUNT_DEFAULT,
  SLIDE_COUNT_MAX,
  SLIDE_COUNT_MIN,
  SLIDE_MAX_BULLETS,
  SLIDE_MAX_BULLET_WORDS,
  SlideDeckExportRequestSchema,
  SlideLayoutTypeSchema,
  STUDIO_INFOGRAPHIC_PLUGIN_TYPE,
  STUDIO_SLIDE_DECK_PLUGIN_TYPE,
  StudioArtifactSchema,
  StudioInfographicExportSceneSchema,
  StudioInfographicPayloadSchema,
  StudioSlideDeckPayloadSchema,
  validateInfographicFocusPrompt,
  validateInfographicPayload,
  validateSafeDeterministicSvg,
  validateSlideDeckPayload,
  validateSlideFocusPrompt,
  type SlideItem,
  type UnifiedDocumentChunk,
} from "../src/index.ts";

/**
 * [015-studio-visuals-presentations] T003 — Contract & Schema tests for Package 4.2
 * (FR-ST-16, FR-ST-17, C-03, D8/DEV-02, D9, Gate v4.0 #3).
 */

const NB = "42000000-0000-4000-8000-000000000001";
const ART = "42000000-aaaa-4000-8000-000000000001";
const SRC = "42000000-0000-4000-8000-000000000101";
const CHUNK = "0190f420-0000-7000-8000-000000000001";

const chunkFixture: UnifiedDocumentChunk = {
  chunk_id: CHUNK,
  source_id: SRC,
  revision: 1,
  text: "Incident response follows 4 stages: Detection, Triage, Containment, and Recovery. Regional uptime reached 99.95% in europe-west4.",
  token_count: 24,
  locator: { page_number: 1, start_offset: 0, end_offset: 125 },
};

const cite = {
  badge_number: 1,
  chunk_id: CHUNK,
  source_id: SRC,
  revision: 1,
  snippet: "Incident response follows 4 stages: Detection, Triage, Containment, and Recovery.",
};

describe("[015-studio-visuals-presentations] T003: Package 4.2 contracts, limits, bullet overflow, OOXML/PDF, and D9 infographics", () => {
  it("exports plugin type constants, layout enums, and enforces Unicode code-point focus_prompt bounds without truncation", () => {
    expect(STUDIO_SLIDE_DECK_PLUGIN_TYPE).toBe("slide_deck");
    expect(STUDIO_INFOGRAPHIC_PLUGIN_TYPE).toBe("infographic");
    expect(SLIDE_COUNT_MIN).toBe(5);
    expect(SLIDE_COUNT_MAX).toBe(20);
    expect(SLIDE_COUNT_DEFAULT).toBe(10);
    expect(SLIDE_MAX_BULLETS).toBe(5);
    expect(SLIDE_MAX_BULLET_WORDS).toBe(15);

    expect(SlideLayoutTypeSchema.options).toEqual([
      "title",
      "two_column",
      "key_metric_callout",
      "comparison_table",
      "diagram_chart",
    ]);
    expect(InfographicStyleSchema.options).toEqual([
      "auto",
      "process_flow",
      "comparison",
      "metrics_summary",
      "architecture_diagram",
    ]);

    // Slide focus_prompt: 0..2,000 trimmed Unicode code points; 2,001 rejected without truncation
    const okSlidePrompt = `  ${"🎯".repeat(2000)}  `;
    const slideCheck = validateSlideFocusPrompt(okSlidePrompt);
    expect(slideCheck.valid).toBe(true);
    expect(slideCheck.codePoints).toBe(2000);
    expect(slideCheck.normalized).toBe("🎯".repeat(2000));
    expect(validateSlideFocusPrompt("🎯".repeat(2001)).valid).toBe(false);

    // Infographic focus_prompt: 0..1,000 trimmed Unicode code points; 1,001 rejected without truncation
    const okInfoPrompt = `  ${"🧩".repeat(1000)}  `;
    const infoCheck = validateInfographicFocusPrompt(okInfoPrompt);
    expect(infoCheck.valid).toBe(true);
    expect(infoCheck.codePoints).toBe(1000);
    expect(infoCheck.normalized).toBe("🧩".repeat(1000));
    expect(validateInfographicFocusPrompt("🧩".repeat(1001)).valid).toBe(false);
  });

  it("validates CreateStudioJobRequestSchema for slide_deck and infographic while blocking cross-plugin field mismatch", () => {
    const slideReq = CreateStudioJobRequestSchema.parse({
      plugin_type: "slide_deck",
      subtype: "default",
      active_source_ids: [SRC],
      slide_count: 8,
      focus_prompt: "Executive architecture brief",
    });
    expect(slideReq.slide_count).toBe(8);

    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "slide_deck",
        subtype: "default",
        active_source_ids: [SRC],
        slide_count: 4,
      }).success
    ).toBe(false);
    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "slide_deck",
        subtype: "default",
        active_source_ids: [SRC],
        slide_count: 21,
      }).success
    ).toBe(false);
    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "slide_deck",
        subtype: "default",
        active_source_ids: [SRC],
        focus_prompt: "x".repeat(2001),
      }).success
    ).toBe(false);
    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "slide_deck",
        subtype: "default",
        active_source_ids: [SRC],
        style: "process_flow",
      }).success
    ).toBe(false);

    const infoReq = CreateStudioJobRequestSchema.parse({
      plugin_type: "infographic",
      subtype: "default",
      active_source_ids: [SRC],
      style: "process_flow",
      focus_prompt: "4-stage incident response",
    });
    expect(infoReq.style).toBe("process_flow");

    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "infographic",
        subtype: "default",
        active_source_ids: [SRC],
        focus_prompt: "y".repeat(1001),
      }).success
    ).toBe(false);
    expect(
      CreateStudioJobRequestSchema.safeParse({
        plugin_type: "infographic",
        subtype: "default",
        active_source_ids: [SRC],
        slide_count: 8,
      }).success
    ).toBe(false);

    // Export request schemas forbid Google Slides (D8/DEV-02)
    expect(SlideDeckExportRequestSchema.parse({ format: "pptx" }).format).toBe("pptx");
    expect(SlideDeckExportRequestSchema.parse({ format: "pdf" }).format).toBe("pdf");
    expect(SlideDeckExportRequestSchema.safeParse({ format: "google_slides" }).success).toBe(false);
    expect(InfographicExportRequestSchema.parse({ format: "svg" }).format).toBe("svg");
    expect(InfographicExportRequestSchema.parse({ format: "png" }).format).toBe("png");
  });

  it("enforces <= 5 bullets and <= 15 words per bullet by routing overflow text deterministically into speaker_notes", () => {
    const normalized = enforceSlideBulletLimit(
      [
        "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen",
        "Bullet two stays short",
        "Bullet three stays short",
        "Bullet four stays short",
        "Bullet five stays short",
        "Overflow sixth bullet pushed to speaker notes",
      ],
      "Base speaker notes."
    );
    expect(normalized.bullets).toHaveLength(5);
    for (const b of normalized.bullets) {
      expect(b.split(/\s+/).length).toBeLessThanOrEqual(15);
    }
    expect(normalized.speaker_notes).toContain("Base speaker notes.");
    expect(normalized.speaker_notes).toContain("sixteen seventeen eighteen");
    expect(normalized.speaker_notes).toContain("Overflow sixth bullet pushed to speaker notes");

    const sanitized = enforceSlideBulletLimit(
      ["<scr<script>ipt>safe <<script>alert(1)</script>text"],
      "<b<bold>>Notes</b>"
    );
    expect(sanitized.bullets[0]).not.toMatch(/<[A-Za-z!/]/);
    expect(sanitized.speaker_notes).not.toMatch(/<[A-Za-z!/]/);
    expect(sanitized.bullets[0]).toContain("safe");
    expect(sanitized.speaker_notes).toContain("Notes");
  });

  it("validates StudioSlideDeckPayloadSchema, OOXML .pptx entries, and 16:9 multi-page .pdf bytes (FR-ST-16, Gate v4.0 #3)", () => {
    const layouts = ["title", "two_column", "key_metric_callout", "comparison_table", "diagram_chart"] as const;
    const slides: SlideItem[] = Array.from({ length: 8 }, (_, idx) => {
      const layout = layouts[idx % layouts.length]!;
      return {
        slide_number: idx + 1,
        layout,
        title: `Slide ${idx + 1}: Incident Lifecycle`,
        bullets: [`Stage ${idx + 1} verified response milestone [1]`],
        visual_spec: {
          layout,
          subtitle: `Summary ${idx + 1}`,
          ...(layout === "key_metric_callout" ? { callout: { value: "99.95%", label: "Regional Uptime" } } : {}),
          ...(layout === "two_column"
            ? {
                columns: {
                  left_heading: "Detection",
                  left_points: ["Automated alerts"],
                  right_heading: "Recovery",
                  right_points: ["Validated rollback"],
                },
              }
            : {}),
          ...(layout === "comparison_table"
            ? { table: { headers: ["Phase", "Owner"], rows: [["Detection", "SRE"]] } }
            : {}),
          ...(layout === "diagram_chart" ? { diagram_steps: ["Detection", "Triage", "Containment", "Recovery"] } : {}),
        },
        speaker_notes: `Detailed executive presenter notes for slide ${idx + 1}.`,
        source_chunk_ids: [CHUNK],
        citations: [cite],
      };
    });

    const payload = StudioSlideDeckPayloadSchema.parse({
      slides,
      target_count: 8,
      insufficient_evidence_note: null,
      citations: [cite],
    });
    expect(validateSlideDeckPayload(payload, [chunkFixture], [{ source_id: SRC, revision: 1 }])).toBeNull();

    const artifact = StudioArtifactSchema.parse({
      id: ART,
      notebook_id: NB,
      plugin_type: "slide_deck",
      subtype: "default",
      status: "Completed",
      title: "Slide Deck",
      params_json: { slide_count: 8 },
      payload_json: payload,
      source_revisions_snapshot: [{ source_id: SRC, revision: 1 }],
      output_language: "en-US",
      progress: null,
      failure: null,
      attempt: 1,
      retry_of: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(artifact.plugin_type).toBe("slide_deck");

    const ooxml = buildSlideDeckOoxmlEntries("Incident Response Deck", payload);
    const names = ooxml.map((e) => e.name);
    expect(names).toContain("[Content_Types].xml");
    expect(names).toContain("_rels/.rels");
    expect(names).toContain("ppt/presentation.xml");
    expect(names).toContain("ppt/slides/slide8.xml");
    expect(names).toContain("ppt/notesSlides/notesSlide8.xml");
    expect(ooxml.find((e) => e.name === "ppt/presentation.xml")!.content).toContain('cx="12192000" cy="6858000"');
    expect(ooxml.find((e) => e.name === "ppt/notesSlides/notesSlide3.xml")!.content).toContain(
      "Detailed executive presenter notes for slide 3."
    );

    const pdfBytes = buildSlideDeckPdfBytes("Incident Response Deck", payload);
    const pdfAscii = Buffer.from(pdfBytes).toString("latin1");
    expect(pdfAscii.startsWith("%PDF-1.4")).toBe(true);
    expect(pdfAscii).toContain("/Count 8");
    expect(pdfAscii).toContain("/MediaBox [0 0 960 540]");
  });

  it("renders crisp non-overlapping deterministic SVG across all 4 infographic styles and validates StudioInfographicPayloadSchema (FR-ST-17, D9)", () => {
    const blocks = [
      {
        id: "step_1",
        heading: "Stage 1: Automated Detection & Telemetry Ingestion with Very Long Descriptive Label",
        body: "Alerts trigger immediately when regional latency or availability thresholds deviate across europe-west4 endpoints.",
        metric_value: "99.95%",
        metric_label: "SLA Target",
        category: "Phase A",
        badge_numbers: [1],
      },
      {
        id: "step_2",
        heading: "Stage 2: Triage & Ownership Routing",
        body: "On-call responders classify severity and verify scope snapshots before mitigation.",
        metric_value: "< 5 min",
        metric_label: "Triage Time",
        category: "Phase A",
        badge_numbers: [1],
      },
      {
        id: "step_3",
        heading: "Stage 3: Containment & Rollback",
        body: "Automated isolation prevents cross-tenant leakage during active incidents.",
        metric_value: "0",
        metric_label: "Leakage",
        category: "Phase B",
        badge_numbers: [1],
      },
      {
        id: "step_4",
        heading: "Stage 4: Verified Recovery & Postmortem",
        body: "Re-verify all checkpoints before closing the incident timeline.",
        metric_value: "4",
        metric_label: "Stages",
        category: "Phase B",
        badge_numbers: [1],
      },
    ];

    for (const style of ["process_flow", "comparison", "metrics_summary", "architecture_diagram"] as const) {
      const { svg, width, height } = renderInfographicSvg({
        style,
        title: "Incident Response Workflow Overview",
        subtitle: "Grounded operational stages",
        blocks,
        citations: [{ badge_number: 1, label: "Incident Response Runbook" }],
      });
      expect(width).toBeGreaterThan(600);
      expect(height).toBeGreaterThan(300);
      expect(validateSafeDeterministicSvg(svg).valid).toBe(true);
      expect(svg).toContain("AI-generated");
      expect(svg).toContain("Illustration");
      expect(svg).toContain("Stage 1: Automated");
      expect(svg).toContain("Detection");

      const payload = StudioInfographicPayloadSchema.parse({
        style,
        title: "Incident Response Workflow Overview",
        subtitle: "Grounded operational stages",
        structured_blocks: blocks,
        rendered_svg: svg,
        source_chunk_ids: [CHUNK],
        citations: [cite],
      });
      expect(validateInfographicPayload(payload, [chunkFixture], [{ source_id: SRC, revision: 1 }])).toBeNull();
    }

    const scene = StudioInfographicExportSceneSchema.parse({
      format: "png",
      svg: renderInfographicSvg({
        style: "process_flow",
        title: "Incident Response",
        blocks,
        citations: [{ badge_number: 1, label: "Runbook" }],
      }).svg,
      width: 960,
      height: 620,
      scale: 2,
      filename: "infographic-42000000.png",
    });
    expect(scene.scale).toBe(2);
  });
});
