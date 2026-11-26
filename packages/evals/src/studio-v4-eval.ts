import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  buildSlideDeckOoxmlEntries,
  buildSlideDeckPdfBytes,
  enforceSlideBulletLimit,
  renderInfographicSvg,
  StudioInfographicPayloadSchema,
  StudioSlideDeckPayloadSchema,
  validateInfographicPayload,
  validateSafeDeterministicSvg,
  validateSlideDeckPayload,
  type SlideItem,
  type StudioEvidenceRef,
} from "@everlast/contracts";
import {
  buildThreeSourceStudioFixture,
  STUDIO_LEAK_PROBE,
} from "@everlast/testkit/studio-structure-fixtures";

/**
 * [015-studio-visuals-presentations] T021 — Deterministic Gate v4.0 #3 quality, citation-grounding,
 * zero-leakage, bullet-cap overflow, OOXML `.pptx`, 16:9 multi-page `.pdf`, and D9 SVG safety evaluation
 * (`FR-ST-16`, `FR-ST-17`, `D9`, `C-02`, `C-03`, `NFR-SEC-02`, `NFR-EVAL-02/04`, `Gate v4.0 #3`).
 */

export interface StudioVisualsDeterministicReport {
  citation_precision: number;
  leakage_count: number;
  slide_count: number;
  bullet_overflow_routed_to_notes: boolean;
  ooxml_pptx_verified: boolean;
  pdf_16x9_verified: boolean;
  infographic_dynamic_wrap_verified: boolean;
  invalid_citation_rejected: boolean;
  xss_svg_rejected: boolean;
  passed: boolean;
}

const SLIDE_LAYOUTS = [
  "title",
  "two_column",
  "key_metric_callout",
  "comparison_table",
  "diagram_chart",
] as const;

type StudioVisualsFixture = ReturnType<typeof buildThreeSourceStudioFixture>;

function requireItem<T>(items: readonly T[], index: number, label: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Missing ${label} at index ${index}`);
  }
  return item;
}

function buildEvalSlides(
  sampleChunks: StudioVisualsFixture["chunks"],
  citations: readonly StudioEvidenceRef[],
): SlideItem[] {
  return sampleChunks.map((chunk, idx) => {
    const layout = requireItem(SLIDE_LAYOUTS, idx % SLIDE_LAYOUTS.length, "slide layout");
    const cite = requireItem(citations, idx, "slide citation");
    const { bullets, speaker_notes } = enforceSlideBulletLimit(
      [chunk.text],
      `${chunk.text} [ref ${cite.badge_number}]`,
    );
    const firstBullet = bullets[0] ?? "";
    return {
      slide_number: idx + 1,
      layout,
      title: `Architecture Slide ${idx + 1}`,
      bullets,
      visual_spec: {
        layout,
        subtitle: `Grounded section ${idx + 1}`,
        ...(layout === "key_metric_callout"
          ? { callout: { value: `${99 + (idx % 2)}%`, label: "Regional SLA" } }
          : {}),
        ...(layout === "two_column"
          ? {
              columns: {
                left_heading: "System Fact",
                left_points: bullets.slice(0, 1),
                right_heading: "Citation Ref",
                right_points: [`Source excerpt [${cite.badge_number}]`],
              },
            }
          : {}),
        ...(layout === "comparison_table"
          ? {
              table: {
                headers: ["Topic", "Detail", "Cite"],
                rows: [[`Slide ${idx + 1}`, firstBullet, `[${cite.badge_number}]`]],
              },
            }
          : {}),
        ...(layout === "diagram_chart"
          ? { diagram_steps: ["Validate", "Extract", "Verify", "Publish"] }
          : {}),
      },
      speaker_notes,
      source_chunk_ids: [chunk.chunk_id],
      citations: [cite],
    };
  });
}

function verifyOoxmlEntries(
  deckPayload: ReturnType<typeof StudioSlideDeckPayloadSchema.parse>,
): boolean {
  const entries = buildSlideDeckOoxmlEntries("Architecture Eval Deck", deckPayload);
  const byName = new Map(entries.map((e) => [e.name, e.content]));
  if (!byName.has("[Content_Types].xml") || !byName.has("ppt/presentation.xml")) {
    return false;
  }
  for (let k = 1; k <= 8; k++) {
    const slideXml = byName.get(`ppt/slides/slide${k}.xml`) ?? "";
    const notesXml = byName.get(`ppt/notesSlides/notesSlide${k}.xml`) ?? "";
    const slideRels = byName.get(`ppt/slides/_rels/slide${k}.xml.rels`) ?? "";
    if (
      !slideXml.includes("<p:sp>") ||
      !slideXml.includes(`Architecture Slide ${k}`) ||
      !notesXml.includes(`[ref ${k}]`) ||
      !slideRels.includes(`notesSlide${k}.xml`) ||
      /vba|activeX|TargetMode="External"/i.test(slideXml + slideRels)
    ) {
      return false;
    }
  }
  return true;
}

function extractPdfText(items: readonly object[]): string {
  return items
    .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
    .join(" ");
}

async function verifySlideDeckPdf(
  deckPayload: ReturnType<typeof StudioSlideDeckPayloadSchema.parse>,
): Promise<boolean> {
  const pdfBytes = buildSlideDeckPdfBytes("Architecture Eval Deck", deckPayload);
  const task = getDocument({
    data: pdfBytes,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const p1 = await doc.getPage(1);
    const vp1 = p1.getViewport({ scale: 1 });
    const p1Text = extractPdfText((await p1.getTextContent()).items);
    const p8 = await doc.getPage(8);
    const p8Text = extractPdfText((await p8.getTextContent()).items);
    return (
      doc.numPages === 8 &&
      Math.round(vp1.width) === 960 &&
      Math.round(vp1.height) === 540 &&
      p1Text.includes("Architecture Slide 1") &&
      p8Text.includes("Architecture Slide 8")
    );
  } finally {
    await task.destroy();
  }
}

function verifyInfographicEval(
  sampleChunks: StudioVisualsFixture["chunks"],
  citations: readonly StudioEvidenceRef[],
  fixture: StudioVisualsFixture,
): {
  infographicErr: string | null;
  leaked: boolean;
  dynamicWrapVerified: boolean;
  xssRejected: boolean;
} {
  const shortRender = renderInfographicSvg({
    style: "process_flow",
    title: "Incident Response",
    blocks: [{ id: "s1", heading: "Step 1", body: "Detect issue.", badge_numbers: [1] }],
    citations: [{ badge_number: 1, label: "Source A" }],
  });
  const longBlocks = [
    {
      id: "s1",
      heading: "Stage 1 Automated Telemetry Detection Across Regional Cloud Run Revisions",
      body: "Continuous multi-region monitoring detects latency spikes, elevated error rates, and saturation anomalies automatically without leaking tenant metadata [1].",
      badge_numbers: [1],
    },
    {
      id: "s2",
      heading: "Stage 2 Immediate Revision Containment And Atomic Rollback Verification",
      body: "Traffic shifts instantaneously away from degraded revisions while preserving database invariants and read consistency across all active pools [1].",
      badge_numbers: [1],
    },
  ];
  const longRender = renderInfographicSvg({
    style: "process_flow",
    title: "Incident Response Workflow",
    blocks: longBlocks,
    citations: [{ badge_number: 1, label: "Runbook Source" }],
  });
  const firstChunk = requireItem(sampleChunks, 0, "sample chunk");
  const firstCitation = requireItem(citations, 0, "sample citation");
  const infographicPayload = StudioInfographicPayloadSchema.parse({
    style: "process_flow",
    title: "Incident Response Workflow",
    structured_blocks: longBlocks,
    rendered_svg: longRender.svg,
    source_chunk_ids: [firstChunk.chunk_id],
    citations: [firstCitation],
  });
  const infographicErr = validateInfographicPayload(
    infographicPayload,
    fixture.chunks,
    fixture.snapshot,
  );
  const leaked = JSON.stringify(infographicPayload).includes(STUDIO_LEAK_PROBE);
  const dynamicWrapVerified =
    infographicErr === null &&
    validateSafeDeterministicSvg(longRender.svg).valid &&
    longRender.height > shortRender.height &&
    longRender.svg.includes("AI-generated");

  const xssAttempt = {
    ...infographicPayload,
    rendered_svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><script>alert(1)</script></svg>`,
  };
  const xssRejected =
    validateInfographicPayload(xssAttempt, fixture.chunks, fixture.snapshot) !== null;
  return { infographicErr, leaked, dynamicWrapVerified, xssRejected };
}

export async function runStudioVisualsDeterministicEval(): Promise<StudioVisualsDeterministicReport> {
  const fixture = buildThreeSourceStudioFixture();
  const sampleChunks = fixture.chunks.slice(0, 8);
  const citations: StudioEvidenceRef[] = sampleChunks.map((c, idx) => ({
    badge_number: idx + 1,
    chunk_id: c.chunk_id,
    source_id: c.source_id,
    revision: c.revision,
    snippet: c.text.slice(0, 160),
  }));

  const deckPayload = StudioSlideDeckPayloadSchema.parse({
    slides: buildEvalSlides(sampleChunks, citations),
    target_count: 8,
    insufficient_evidence_note: null,
    citations,
  });

  // 1. Grounded validation & zero-leakage check
  const deckValidationErr = validateSlideDeckPayload(deckPayload, fixture.chunks, fixture.snapshot);
  let leakageCount = JSON.stringify(deckPayload).includes(STUDIO_LEAK_PROBE) ? 1 : 0;

  // 2. Bullet overflow routing check (> 15 words truncated cleanly with full clause in speaker_notes)
  const verbose =
    "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen overflowTokenOmega.";
  const capped = enforceSlideBulletLimit([verbose], "Base notes.");
  const cappedBullet = capped.bullets[0] ?? "";
  const bulletOverflowRouted =
    capped.bullets.length === 1 &&
    cappedBullet.split(/\s+/).length <= 15 &&
    capped.speaker_notes.includes("overflowTokenOmega");

  // 3. Invalid / unselected citation rejection check (NFR-EVAL-02 / NFR-EVAL-04)
  const forgedDeck = structuredClone(deckPayload) as Record<string, unknown> & {
    citations: StudioEvidenceRef[];
  };
  const outChunk = requireItem(fixture.unselectedChunks, 0, "unselected chunk");
  forgedDeck.citations.push({
    badge_number: 99,
    chunk_id: outChunk.chunk_id,
    source_id: outChunk.source_id,
    revision: 1,
    snippet: outChunk.text,
  });
  const invalidCitationRejected =
    validateSlideDeckPayload(forgedDeck, fixture.chunks, fixture.snapshot) !== null;

  // 4 & 5. OOXML .pptx and 16:9 multi-page .pdf verification
  const ooxmlVerified = verifyOoxmlEntries(deckPayload);
  const pdfVerified = await verifySlideDeckPdf(deckPayload);

  // 6. Infographic D9 SVG dynamic height expansion + XSS rejection
  const infographic = verifyInfographicEval(sampleChunks, citations, fixture);
  if (infographic.leaked) {
    leakageCount++;
  }

  const citationPrecision =
    deckValidationErr === null && infographic.infographicErr === null ? 1 : 0;
  const passed =
    citationPrecision === 1 &&
    leakageCount === 0 &&
    deckPayload.slides.length === 8 &&
    bulletOverflowRouted &&
    ooxmlVerified &&
    pdfVerified &&
    infographic.dynamicWrapVerified &&
    invalidCitationRejected &&
    infographic.xssRejected;

  return {
    citation_precision: citationPrecision,
    leakage_count: leakageCount,
    slide_count: deckPayload.slides.length,
    bullet_overflow_routed_to_notes: bulletOverflowRouted,
    ooxml_pptx_verified: ooxmlVerified,
    pdf_16x9_verified: pdfVerified,
    infographic_dynamic_wrap_verified: infographic.dynamicWrapVerified,
    invalid_citation_rejected: invalidCitationRejected,
    xss_svg_rejected: infographic.xssRejected,
    passed,
  };
}
