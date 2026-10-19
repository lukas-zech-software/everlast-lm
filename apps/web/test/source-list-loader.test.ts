import { describe, expect, it, vi } from "vitest";
import { fetchNotebookSources } from "../src/sources/list.js";

const notebookId = "11111111-1111-4111-8111-111111111111";
const source = { id: "22222222-2222-4222-8222-222222222222", notebook_id: notebookId, title: "Brief.pdf", media_type: "application/pdf" as const, status: "Ready" as const, revision_id: 3 };

describe("authorized notebook source-list loader (FR-SI-02, C-02)", () => {
  it("loads only the server-provided source snapshot and fails closed on denied responses", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ sources: [source] }) } as Response));
    await expect(fetchNotebookSources(notebookId, fetcher)).resolves.toEqual([source]);
    expect(fetcher).toHaveBeenCalledWith(`/api/notebooks/${notebookId}/sources`);
    await expect(fetchNotebookSources(notebookId, vi.fn(async () => ({ ok: false } as Response)))).rejects.toThrow(/authorized sources/);
  });
});
