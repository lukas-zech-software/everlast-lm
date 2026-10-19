import { describe, expect, it } from "vitest";
import { createOcrEngine, layoutParserPages } from "../src/ocr.ts";

/** FR-SI-01 OCR adapter parsing (Document AI Layout Parser response shape) and configuration. */

describe("Document AI OCR adapter", () => {
  it("OCR-01: flattens Layout Parser blocks per page and keeps table rows", () => {
    const pages = layoutParserPages([
      { pageSpan: { pageStart: 4, pageEnd: 4 }, textBlock: { text: "Scanned heading", blocks: [{ pageSpan: { pageStart: 4 }, textBlock: { text: "Body paragraph." } }] } },
      {
        pageSpan: { pageStart: 4, pageEnd: 4 },
        tableBlock: {
          headerRows: [{ cells: [{ blocks: [{ textBlock: { text: "Item" } }] }, { blocks: [{ textBlock: { text: "Cost" } }] }] }],
          bodyRows: [{ cells: [{ blocks: [{ textBlock: { text: "Pump" } }] }, { blocks: [{ textBlock: { text: "€40" } }] }] }],
        },
      },
      { pageSpan: { pageStart: 7 }, textBlock: { text: "Other page" } },
    ]);
    expect(pages.get(4)).toBe("Scanned heading\n\nBody paragraph.\n\nItem | Cost\nPump | €40");
    expect(pages.get(7)).toBe("Other page");
  });

  it("OCR-02: the provisioned processor resource name configures project, location and id", () => {
    const engine = createOcrEngine({ DOCUMENT_AI_PROCESSOR_NAME: "projects/p1/locations/eu/processors/abc123" });
    expect(engine.name).toBe("documentai:eu:abc123");
    expect(createOcrEngine({}).name).toBe("none");
  });
});
