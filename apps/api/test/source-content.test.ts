import { describe, it, expect, vi } from "vitest";
import { handleSourceContentRoute } from "../src/routes/source-content.js";
import { handleInspectorRoute } from "../src/routes/inspector.js";

describe("FR-SI-04: API Source Content / Inspector Route Tests", () => {
  const notebookId = "22222222-2222-4222-8222-222222222222";
  const sourceId = "33333333-3333-4333-8333-333333333333";
  const targetChunkId = "44444444-4444-4444-8444-444444444445";

  it("returns 200 with ordered chunks and highlight_chunk_id for valid ready source", async () => {
    const mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes("FROM sources")) {
          return {
            rowCount: 1,
            rows: [{ id: sourceId, notebook_id: notebookId, status: "Ready" }],
          };
        }
        if (sql.includes("FROM document_chunks")) {
          return {
            rowCount: 2,
            rows: [
              {
                chunk_id: "chk_1",
                source_id: sourceId,
                revision: 1,
                token_count: 350,
                text: "Passage 1",
                locator: JSON.stringify({ page_number: 1, start_offset: 0, end_offset: 9 }),
              },
              {
                chunk_id: targetChunkId,
                source_id: sourceId,
                revision: 1,
                token_count: 400,
                text: "Passage 2 target",
                locator: JSON.stringify({ page_number: 1, start_offset: 10, end_offset: 25 }),
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      }),
    };

    const res = await handleSourceContentRoute(
      {
        params: { notebookId, sourceId },
        query: { chunk_id: targetChunkId },
      },
      mockDb as any
    );

    expect(res.status).toBe(200);
    expect(res.body.source_id).toBe(sourceId);
    expect(res.body.chunks).toHaveLength(2);
    expect(res.body.highlight_chunk_id).toBe(targetChunkId);
  });

  it("returns 404 when source does not exist in notebook", async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };

    const res = await handleInspectorRoute(
      {
        params: { notebookId, sourceId: "00000000-0000-0000-0000-000000000000" },
        query: {},
      },
      mockDb as any
    );

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("SourceNotFoundError");
  });

  it("returns 409 when source is not in Ready state", async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ id: sourceId, notebook_id: notebookId, status: "Processing" }],
      }),
    };

    const res = await handleSourceContentRoute(
      {
        params: { notebookId, sourceId },
        query: {},
      },
      mockDb as any
    );

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("SourceNotReadyError");
  });

  it("returns 400 when notebookId or sourceId is not a valid UUID", async () => {
    const mockDb = { query: vi.fn() };

    const res = await handleSourceContentRoute(
      {
        params: { notebookId: "invalid-uuid", sourceId },
        query: {},
      },
      mockDb as any
    );

    expect(res.status).toBe(400);
  });
});
