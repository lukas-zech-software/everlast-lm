import { GoogleAuth } from "google-auth-library";

/**
 * OCR boundary for scanned PDF pages (FR-SI-01). Production uses a Document AI processor (Enterprise OCR or
 * Layout Parser) in the EU multi-region with keyless ADC; recognized text feeds the same canonical page text
 * as native PDF extraction.
 */

export interface OcrEngine {
  readonly name: string;
  /** Recognizes text for 1-based page numbers of a PDF; missing pages mean no text was found. */
  recognize(pdf: Buffer, pages: number[]): Promise<Map<number, string>>;
}

export class OcrUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrUnavailableError";
  }
}

/** Used when no OCR processor is configured: scanned pages yield no text and the source fails clearly. */
export class NoOcrEngine implements OcrEngine {
  readonly name = "none";

  async recognize(): Promise<Map<number, string>> {
    return new Map();
  }
}

interface DocAiTextSegment {
  startIndex?: string;
  endIndex?: string;
}

interface LayoutBlock {
  pageSpan?: { pageStart?: number; pageEnd?: number };
  textBlock?: { text?: string; blocks?: LayoutBlock[] };
  tableBlock?: { headerRows?: { cells?: { blocks?: LayoutBlock[] }[] }[]; bodyRows?: { cells?: { blocks?: LayoutBlock[] }[] }[] };
  listBlock?: { listEntries?: { blocks?: LayoutBlock[] }[] };
}

interface DocAiDocument {
  text?: string;
  pages?: { pageNumber?: number; layout?: { textAnchor?: { textSegments?: DocAiTextSegment[] } } }[];
  documentLayout?: { blocks?: LayoutBlock[] };
}

/** Flattens Layout Parser blocks into per-page text, preserving table rows as " | " separated lines. */
export function layoutParserPages(blocks: LayoutBlock[]): Map<number, string> {
  const pages = new Map<number, string[]>();
  const add = (page: number | undefined, text: string) => {
    if (!page || !text.trim()) return;
    pages.set(page, [...(pages.get(page) ?? []), text.trim()]);
  };
  const textOf = (list: LayoutBlock[] | undefined): string =>
    (list ?? []).map((b) => [b.textBlock?.text ?? "", textOf(b.textBlock?.blocks)].filter(Boolean).join("\n")).filter(Boolean).join(" ");
  const visit = (block: LayoutBlock) => {
    const page = block.pageSpan?.pageStart;
    if (block.textBlock) {
      add(page, block.textBlock.text ?? "");
      (block.textBlock.blocks ?? []).forEach(visit);
    }
    if (block.tableBlock) {
      const rows = [...(block.tableBlock.headerRows ?? []), ...(block.tableBlock.bodyRows ?? [])];
      add(page, rows.map((row) => (row.cells ?? []).map((cell) => textOf(cell.blocks)).join(" | ")).join("\n"));
    }
    if (block.listBlock) (block.listBlock.listEntries ?? []).forEach((entry) => (entry.blocks ?? []).forEach(visit));
  };
  blocks.forEach(visit);
  return new Map([...pages].map(([page, parts]) => [page, parts.join("\n\n")]));
}

const ONLINE_PAGE_LIMIT = 15;
const ONLINE_BYTE_LIMIT = 20 * 1024 * 1024;

export class DocumentAiOcr implements OcrEngine {
  readonly name: string;
  private readonly auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  private readonly endpoint: string;

  constructor(options: { project: string; location: string; processorId: string }) {
    this.name = `documentai:${options.location}:${options.processorId}`;
    this.endpoint = `https://${options.location}-documentai.googleapis.com/v1/projects/${options.project}/locations/${options.location}/processors/${options.processorId}:process`;
  }

  async recognize(pdf: Buffer, pages: number[]): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    if (pages.length === 0) return result;
    if (pdf.length > ONLINE_BYTE_LIMIT) {
      throw new OcrUnavailableError("Scanned PDF exceeds the online OCR size limit");
    }
    const client = await this.auth.getClient();
    for (let i = 0; i < pages.length; i += ONLINE_PAGE_LIMIT) {
      const selection = pages.slice(i, i + ONLINE_PAGE_LIMIT);
      const response = await client.request<{ document?: DocAiDocument }>({
        url: this.endpoint,
        method: "POST",
        data: {
          rawDocument: { content: pdf.toString("base64"), mimeType: "application/pdf" },
          processOptions: { individualPageSelector: { pages: selection } },
          skipHumanReview: true,
        },
      });
      const doc = response.data.document ?? {};
      if (doc.documentLayout?.blocks?.length) {
        for (const [page, text] of layoutParserPages(doc.documentLayout.blocks)) if (selection.includes(page)) result.set(page, text);
        continue;
      }
      const text = Array.from(doc.text ?? "");
      (doc.pages ?? []).forEach((page, index) => {
        const pageNumber = page.pageNumber ?? selection[index];
        if (!pageNumber) return;
        const segments = page.layout?.textAnchor?.textSegments ?? [];
        const pageText = segments
          .map((s) => text.slice(Number(s.startIndex ?? 0), Number(s.endIndex ?? 0)).join(""))
          .join("");
        if (pageText.trim()) result.set(pageNumber, pageText);
      });
    }
    return result;
  }
}

export function createOcrEngine(env: NodeJS.ProcessEnv = process.env): OcrEngine {
  // Accepts the full resource name provisioned by OpenTofu or separate id/location variables.
  const fromName = /^projects\/([^/]+)\/locations\/([^/]+)\/processors\/([^/]+)$/.exec(env.DOCUMENT_AI_PROCESSOR_NAME ?? "");
  const project = fromName?.[1] ?? env.VERTEX_PROJECT ?? env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT;
  const processorId = fromName?.[3] ?? env.DOCUMENT_AI_PROCESSOR_ID;
  const location = fromName?.[2] ?? env.DOCUMENT_AI_LOCATION ?? "eu";
  if (!processorId || !project) return new NoOcrEngine();
  return new DocumentAiOcr({ project, location, processorId });
}
