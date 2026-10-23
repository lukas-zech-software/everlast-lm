import type { DelegationBroker } from "@everlast/api/routes/connections";
import { createDriveAdapter, type DriveApi } from "@everlast/worker/ingestion/drive";
import { createOfficeAdapter } from "@everlast/worker/ingestion/office";
import type { AdapterKey, SourceAdapter } from "@everlast/worker/ingestion/pipeline";
import type { ContentScreener } from "@everlast/worker/ingestion/screening";
import { createWebAdapter, type Transport } from "@everlast/worker/ingestion/web";
import { createAudioAdapter, createVideoAdapter, type Transcriber } from "@everlast/worker/ingestion/media";
import type { ObjectStorage } from "@everlast/cloud";
import { articleHtml, driveSlidesExportFixture, interviewWords, PROMPT_INJECTION_TEXT, roadmapHtml } from "@everlast/testkit/multimodal-fixtures";

/**
 * TEST-ONLY doubles for the package 3.1 browser journeys (specs/009). Clearly labelled stand-ins for external
 * providers: Google OAuth consent + Drive API, Model Armor screening. Office normalization, the ingestion pipeline,
 * operations, PostgreSQL and the UI are real.
 */

/** Consent "redirect" goes straight back to the real callback with a fixed code (no Google round trip). */
export const e2eDelegationBroker: DelegationBroker = {
  authorizationUrl: (state, _challenge) => `/oauth/google/callback?code=e2e-consent&state=${encodeURIComponent(state)}`,
  exchangeAndStore: async (userId) => ({ secretRef: `e2e-secret-${userId}`, scopes: ["https://www.googleapis.com/auth/drive.readonly"], accountLabel: "e2e-owner@example.test" }),
};

const e2eDrive: DriveApi = {
  getMetadata: async (_token, id) => ({ id, name: "Steering deck", mimeType: "application/vnd.google-apps.presentation", version: "1", canDownload: true }),
  exportFile: async () => driveSlidesExportFixture(),
  downloadLongRunning: async () => driveSlidesExportFixture(),
  downloadContent: async () => driveSlidesExportFixture(),
};

/** Deterministic stand-in for Model Armor: quarantines the fixture prompt-injection sentence. */
export const e2eScreener: ContentScreener = {
  name: "e2e-fixture-screener",
  screen: async (texts) => (texts.some((t) => t.includes(PROMPT_INJECTION_TEXT)) ? { verdict: "quarantined", reason: "pi_and_jailbreak" } : { verdict: "clean" }),
};

/** Mutable fixture "internet": the SSRF guard and Readability are real; only DNS and sockets are doubles. */
export const e2eWebPages = new Map<string, { status: number; body: string; delayMs?: number; contentType?: string }>([
  ["https://news.example.test/articles/depot-automation", { status: 200, body: articleHtml() }],
  ["https://news.example.test/forbidden", { status: 403, body: "Forbidden" }],
  ["https://intranet.example.test/roadmap", { status: 200, body: roadmapHtml("May") }],
]);

const e2eTransport: Transport = {
  async request(req) {
    const page = e2eWebPages.get(req.url.toString()) ?? { status: 404, body: "Not found" };
    if (page.delayMs) await new Promise((r) => setTimeout(r, page.delayMs));
    return { status: page.status, headers: { "content-type": page.contentType ?? "text/html; charset=utf-8" }, body: (async function* () { yield Buffer.from(page.body); })() };
  },
};

export const e2eWeb = {
  resolver: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
  transport: e2eTransport,
  policy: { privateNetworks: [], allowedPrivateHosts: [] },
};

/** Labelled Speech-to-Text double: the fixture Interview transcript, cut to the declared duration when known. */
export const e2eTranscriber: Transcriber = {
  name: "e2e-fixture-asr",
  transcribe: async ({ durationMs }) => ({ words: interviewWords().filter((w) => durationMs === null || w.end_ms <= durationMs) }),
};

export function e2eAdapters(storage: ObjectStorage): Partial<Record<AdapterKey, SourceAdapter>> {
  return {
    audio: createAudioAdapter({ transcriber: e2eTranscriber }),
    video: createVideoAdapter({ transcriber: e2eTranscriber, web: e2eWeb, storage }),
    web: createWebAdapter(e2eWeb),
    office: createOfficeAdapter({}),
    drive: createDriveAdapter({ api: e2eDrive, tokens: { accessToken: async () => "e2e-user-token" }, office: {} }),
  };
}

/** TEST-ONLY control endpoint (e2e server only): browser journeys change the fixture "internet" between steps. */
export async function handleE2eControl(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): Promise<boolean> {
  if (req.method !== "POST" || req.url !== "/__e2e/web-page") return false;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { url: string; status?: number; month?: "May" | "June"; html?: string; delayMs?: number; contentType?: string };
  e2eWebPages.set(body.url, {
    status: body.status ?? 200,
    body: body.html ?? (body.month ? roadmapHtml(body.month) : "Not found"),
    ...(body.delayMs ? { delayMs: body.delayMs } : {}),
    ...(body.contentType ? { contentType: body.contentType } : {}),
  });
  res.writeHead(204).end();
  return true;
}
