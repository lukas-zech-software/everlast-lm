import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { StudioSlideDeckPayloadSchema, type SlideItem, type StudioSlideDeckPayload } from "@everlast/contracts";
import { exportSlideDeckArtifact } from "../src/studio/slide-export.ts";

/**
 * [015-studio-visuals-presentations] T008 — Slide Deck OOXML (.pptx) & 16:9 multi-page (.pdf) export tests
 * (FR-ST-16, D8/DEV-02, Gate v4.0 #3).
 */

const SRC = "42000000-0000-4000-8000-000000000101";
const CHUNK = "0190f420-0000-7000-8000-000000000001";
const ART = "42000000-aaaa-4000-8000-000000000001";
const cite = {
  badge_number: 1,
  chunk_id: CHUNK,
  source_id: SRC,
  revision: 1,
  snippet: "Regional services run in europe-west4 with stateless containers.",
};

function makeDeckPayload(slideCount = 8): StudioSlideDeckPayload {
  const layouts = ["title", "two_column", "key_metric_callout", "comparison_table", "diagram_chart"] as const;
  const slides: SlideItem[] = Array.from({ length: slideCount }, (_, i) => {
    const layout = layouts[i % layouts.length]!;
    return {
      slide_number: i + 1,
      layout,
      title: `Slide ${i + 1}: Architecture Milestone`,
      bullets: [`Key finding ${i + 1} verified in europe-west4 [1]`],
      visual_spec: {
        layout,
        subtitle: `Overview ${i + 1}`,
        ...(layout === "key_metric_callout" ? { callout: { value: "99.95%", label: "Availability" } } : {}),
        ...(layout === "diagram_chart" ? { diagram_steps: ["Ingest", "Chunk", "Ground", "Export"] } : {}),
      },
      speaker_notes: `Speaker notes detail for slide ${i + 1}.`,
      source_chunk_ids: [CHUNK],
      citations: [cite],
    };
  });
  return StudioSlideDeckPayloadSchema.parse({
    slides,
    target_count: slideCount,
    insufficient_evidence_note: null,
    citations: [cite],
  });
}

function readZip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThan(0);
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(offset)).toBe(0x02014b50);
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const uncompressed = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extra = buf.readUInt16LE(offset + 30);
    const comment = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compressed);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    expect(data.length).toBe(uncompressed);
    out.set(name, data);
    offset += 46 + nameLen + extra + comment;
  }
  return out;
}

describe("[015-studio-visuals-presentations] T008: Slide Deck PPTX & PDF export unit tests (Gate v4.0 #3)", () => {
  it("builds a complete, macro-free 8-slide OOXML .pptx ZIP archive with editable shapes and linked speaker notes", async () => {
    const payload = makeDeckPayload(8);
    const exported = await exportSlideDeckArtifact({
      artifactId: ART,
      title: "Architecture Brief",
      payload,
      body: { format: "pptx" },
    });

    expect(exported.contentType).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(exported.filename).toMatch(/^slide-deck-42000000\.pptx$/);
    const buf = Buffer.from(exported.bytes);
    expect(buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);

    const entries = readZip(buf);
    expect(entries.has("[Content_Types].xml")).toBe(true);
    expect(entries.has("_rels/.rels")).toBe(true);
    expect(entries.has("ppt/presentation.xml")).toBe(true);
    expect(entries.has("ppt/_rels/presentation.xml.rels")).toBe(true);

    for (let k = 1; k <= 8; k++) {
      const slideXml = entries.get(`ppt/slides/slide${k}.xml`)?.toString("utf8") ?? "";
      const notesXml = entries.get(`ppt/notesSlides/notesSlide${k}.xml`)?.toString("utf8") ?? "";
      const slideRels = entries.get(`ppt/slides/_rels/slide${k}.xml.rels`)?.toString("utf8") ?? "";
      expect(slideXml).toContain(`Slide ${k}: Architecture Milestone`);
      expect(slideXml).toContain("<p:sp>");
      expect(slideRels).toContain(`notesSlide${k}.xml`);
      expect(notesXml).toContain(`Speaker notes detail for slide ${k}.`);
    }

    // No macros, ActiveX, or external links
    for (const [name, content] of entries) {
      expect(name).not.toMatch(/vba|activeX|embeddings|externalLinks/i);
      expect(content.toString("utf8")).not.toMatch(/TargetMode="External"/i);
    }
  });

  it("builds a valid 16:9 8-page .pdf parseable by pdfjs-dist with exact page count and slide text (Gate v4.0 #3)", async () => {
    const payload = makeDeckPayload(8);
    const exported = await exportSlideDeckArtifact({
      artifactId: ART,
      title: "Architecture Brief",
      payload,
      body: { format: "pdf" },
    });

    expect(exported.contentType).toBe("application/pdf");
    expect(exported.filename).toMatch(/^slide-deck-42000000\.pdf$/);

    const loadingTask = getDocument({
      data: exported.bytes,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    });
    const doc = await loadingTask.promise;
    try {
      expect(doc.numPages).toBe(8);
      const page1 = await doc.getPage(1);
      const viewport = page1.getViewport({ scale: 1 });
      expect(Math.round(viewport.width)).toBe(960);
      expect(Math.round(viewport.height)).toBe(540);
      const p1Text = (await page1.getTextContent()).items.map((it: any) => it.str).join(" ");
      expect(p1Text).toContain("Slide 1: Architecture Milestone");
      expect(p1Text).toContain("Key finding 1 verified in europe-west4");

      const page8 = await doc.getPage(8);
      const p8Text = (await page8.getTextContent()).items.map((it: any) => it.str).join(" ");
      expect(p8Text).toContain("Slide 8: Architecture Milestone");
    } finally {
      await loadingTask.destroy();
    }
  });

  it("rejects Google Slides export per D8 / DEV-02", async () => {
    const payload = makeDeckPayload(5);
    await expect(
      exportSlideDeckArtifact({
        artifactId: ART,
        title: "Architecture Brief",
        payload,
        body: { format: "google_slides" },
      })
    ).rejects.toThrow();
  });
});
