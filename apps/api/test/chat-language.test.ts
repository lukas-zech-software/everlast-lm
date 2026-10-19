import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { GroundedChatAgent, type ModelCompletionParams } from "../src/chat/agent.js";
import { handleChatRoute } from "../src/routes/chat.js";
import type { UnifiedDocumentChunk } from "@everlast/contracts";

const notebookId = "99999999-9999-4999-8999-999999999999";
const sourceId = "11111111-1111-4111-8111-111111111111";
const chunkId = "018f6b40-0001-7000-8000-000000000001";
const sourceQuote = "The original English source states that water freezes at zero degrees Celsius.";
const chunks: UnifiedDocumentChunk[] = [{
  chunk_id: chunkId,
  source_id: sourceId,
  revision: 1,
  locator: { page_number: 1, start_offset: 0, end_offset: sourceQuote.length },
  token_count: 20,
  text: sourceQuote,
}];

let server: http.Server;
let baseUrl = "";

afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("Chat language preference boundary (FR-UI-02, FR-GC-03)", () => {
  it("passes resolved input/output languages to the model and retains original-language citation text", async () => {
    let captured: ModelCompletionParams | undefined;
    const getChunksForSources = vi.fn(async () => chunks);
    const agent = new GroundedChatAgent({ modelAdapter: {
      async complete(params) {
        captured = params;
        return { grounded: true, refusal: false, answer: `Die Antwort ist auf Deutsch. <cite id="${chunkId}"/>`, citedChunkIds: [chunkId] };
      },
    } });
    let resolvedBrowserLocale: string | undefined;
    const deps = {
      agent,
      getChunksForSources,
      resolveLanguagePreferences: async (_notebookId: string, _userId: string, browserLocale?: string) => {
        resolvedBrowserLocale = browserLocale;
        return { input_language: "fr-FR", output_language: "de-DE" };
      },
    };
    server = http.createServer((req, res) => { void handleChatRoute(req, res, deps as any, "owner"); });
    await new Promise<void>((resolve) => server.listen(0, () => {
      const address = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    }));

    const response = await fetch(`${baseUrl}/api/notebooks/${notebookId}/chat/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": "xx-XX, fr-fr;q=0.9, en-US;q=0.8" },
      body: JSON.stringify({ message: "Quel temps fait-il?", active_source_ids: [sourceId] }),
    });
    const result = await response.json() as any;
    expect(response.status).toBe(200);
    expect(resolvedBrowserLocale).toBe("fr-FR");
    expect(captured?.systemInstructions).toMatch(/German|de-DE/i);
    expect(captured?.systemInstructions).toMatch(/French|fr-FR/i);
    expect(captured?.chunks[0]?.text).toBe(sourceQuote);
    expect(result.turn.citations[0].snippet).toBe(sourceQuote);
    expect(result.turn.content).toContain("[1]");
    expect(getChunksForSources).toHaveBeenCalledWith(notebookId, [sourceId]);
  });
});
