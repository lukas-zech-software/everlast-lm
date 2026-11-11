import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolveEnterpriseGeminiConfig } from "@everlast/cloud";
import { GoogleGenAI } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGroundedModelFromEnv, ModelUnavailableError } from "../src/chat/model.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("D23 grounded chat transport (FR-GC-01/02/08, NFR-SEC-01)", () => {
  it("rejects an unsupported dedicated region or missing project", () => {
    expect(() => resolveEnterpriseGeminiConfig("flash", { VERTEX_PROJECT: "project", GEMINI_LOCATION: "global" }))
      .toThrow("GEMINI_LOCATION must be eu");
    expect(() => resolveEnterpriseGeminiConfig("flash", { VERTEX_PROJECT: "  " }))
      .toThrow("required for enterprise Gemini");
  });

  it("sends chat, correction and private probes to the pinned EU Flash route using ADC", async () => {
    // Supply fake ADC via local metadata and intercept generation only at the final SDK fetch.
    const metadata = createServer((request, response) => {
      if (request.url?.split("?")[0] !== "/computeMetadata/v1/instance/service-accounts/default/token") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "Metadata-Flavor": "Google", "Content-Type": "application/json" });
      response.end(JSON.stringify({ access_token: "fixture-adc-token", expires_in: 3600, token_type: "Bearer" }));
    });
    metadata.listen(0, "127.0.0.1");
    await once(metadata, "listening");
    try {
      vi.stubEnv("GCE_METADATA_HOST", `127.0.0.1:${(metadata.address() as AddressInfo).port}`);
      vi.stubEnv("METADATA_SERVER_DETECTION", "assume-present");
      vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", undefined);
      vi.stubEnv("CLOUDSDK_CONFIG", "/nonexistent-everlast-adc-fixture");
      vi.stubEnv("GOOGLE_CLOUD_PROJECT", "sdk-project");
      vi.stubEnv("GOOGLE_CLOUD_LOCATION", "global");
      vi.stubEnv("GOOGLE_GENAI_USE_VERTEXAI", "false");
      vi.stubEnv("GOOGLE_VERTEX_BASE_URL", "https://vertex-override.invalid");
      vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "https://developer-override.invalid");
      vi.stubEnv("GOOGLE_API_KEY", "fixture-developer-key");
      vi.stubEnv("GEMINI_API_KEY", undefined);

      const draft = { status: "not_in_sources", missing_topic: "world cup", sentences: [] };
      const responses = [draft, { code: "print(1)" }, draft];
      const requests: { url: URL; headers: Headers; body: Record<string, unknown> }[] = [];
      const fetchMetadata = globalThis.fetch;
      vi.stubGlobal("fetch", async (url: string | URL | Request, init: RequestInit) => {
        const target = new URL(url instanceof Request ? url.url : url);
        if (target.host === process.env.GCE_METADATA_HOST) return fetchMetadata(url, init);
        requests.push({ url: target, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
        const result = responses.shift();
        return result
          ? Response.json({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(result) }] }, finishReason: "STOP" }] })
          : Response.json({ error: { code: 503, status: "UNAVAILABLE" } }, { status: 503 });
      });

      const model = createGroundedModelFromEnv({
        VERTEX_PROJECT: "approved-project",
        VERTEX_LOCATION: "europe-west4",
        CHAT_MODEL: "gemini-2.5-flash",
      });
      const chat = { question: "Who won the FIFA World Cup?", chunks: [], history: [] };
      expect(await model.generate(chat)).toEqual(draft);
      expect(await model.correctCode!({ question: "Calculate", intent: "Sum", values: [], failedCode: "raise", stderr: "Exception" })).toBe("print(1)");
      expect(await model.generate({ ...chat, operationalProbe: true })).toEqual(draft);
      await expect(model.generate({ ...chat, operationalProbe: true })).rejects.toBeInstanceOf(ModelUnavailableError);
      await expect(model.generate({ ...chat, question: "é".repeat(51_000), operationalProbe: true })).rejects.toBeInstanceOf(ModelUnavailableError);

      expect(requests).toHaveLength(4);
      for (const request of requests) {
        expect(request.url.origin).toBe("https://aiplatform.eu.rep.googleapis.com");
        expect(request.url.pathname).toMatch(/^\/v1(?:beta1)?\/projects\/approved-project\/locations\/eu\/publishers\/google\/models\/gemini-3\.8-flash:generateContent$/);
        expect(request.url.searchParams.has("key")).toBe(false);
        expect(request.headers.has("x-goog-api-key")).toBe(false);
        expect(request.headers.get("authorization")).toBe("Bearer fixture-adc-token");
        expect(request.body.generationConfig).toMatchObject({
          thinkingConfig: { thinkingLevel: "LOW" },
          responseMimeType: "application/json",
        });
      }
      expect(model.id).toBe("vertex:eu:gemini-3.8-flash");
      expect(requests[0]!.body.generationConfig).not.toHaveProperty("maxOutputTokens");
      expect(requests[1]!.body.generationConfig).not.toHaveProperty("maxOutputTokens");
      expect(requests[2]!.body.generationConfig).toHaveProperty("maxOutputTokens", 512);
      expect(requests[3]!.body.generationConfig).toHaveProperty("maxOutputTokens", 512);

      // Downstream consumers use the same options with their direct SDK client.
      const lite = resolveEnterpriseGeminiConfig("flash-lite", {
        GCP_PROJECT_ID: "approved-project",
        GEMINI_LOCATION: "eu",
        VERTEX_LOCATION: "europe-west4",
      });
      responses.push(draft);
      const sdk = new GoogleGenAI(lite.clientOptions);
      await sdk.models.generateContent({
        model: lite.model,
        contents: "Fixture",
        config: { thinkingConfig: lite.thinkingConfig },
      });
      expect(requests).toHaveLength(5);
      const direct = requests[4]!;
      expect(direct.url.origin).toBe("https://aiplatform.eu.rep.googleapis.com");
      expect(direct.url.pathname).toMatch(/\/projects\/approved-project\/locations\/eu\/publishers\/google\/models\/gemini-3\.5-flash-lite:generateContent$/);
      expect(direct.url.searchParams.has("key")).toBe(false);
      expect(direct.headers.has("x-goog-api-key")).toBe(false);
      expect(direct.headers.get("authorization")).toBe("Bearer fixture-adc-token");
      expect(direct.body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: "MINIMAL" } });
    } finally {
      await new Promise<void>((resolve, reject) => metadata.close((error) => error ? reject(error) : resolve()));
    }
  });
});
