import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_TRANSCRIPT_MESSAGE, TimeSpanLocatorSchema } from "@everlast/contracts";
import { admitLinkedImport, getSourceById } from "@everlast/db";
import {
  INTERVIEW_CITED_MS,
  INTERVIEW_CITED_STATEMENT,
  INTERVIEW_DURATION_MS,
  VIDEO_CAPTIONS_VTT,
  interviewMp3,
  interviewWords,
  m4aFixture,
  shortWav,
  videoPageHtml,
} from "@everlast/testkit/multimodal-fixtures";
import {
  assembleSegments,
  createAudioAdapter,
  createVideoAdapter,
  parseProviderOffset,
  parseWebVtt,
  wavDurationMs,
  type TranscribeInput,
  type Transcriber,
  type TranscriptWord,
} from "../src/ingestion/media.ts";
import { processIngestJob } from "../src/ingestion/pipeline.ts";
import type { Transport } from "../src/ingestion/web.ts";
import { FixtureOcr, createWorkerHarness, type WorkerHarness } from "./support.ts";

/**
 * [009-multimodal-ingestion-sync] T025 — caption/ASR ingestion (FR-SI-01, FR-SI-05, C-01, NFR-SEC-02; spec FR-004,
 * FR-006, FR-007, FR-016, SC-001, SC-006): MP3/WAV/M4A transcription and accessible video captions/audio produce
 * chunks that each carry an integer, monotonic, duration-bounded C-01 `time_span`; inaccessible video fails with
 * "No transcript available for this video"; the transcriber reads the exact immutable upload generation.
 * Speech-to-Text is a labelled test double here (live Chirp 2 runs are UNAVAILABLE in this environment).
 */

class FixtureTranscriber implements Transcriber {
  readonly name = "fixture-asr";
  calls: TranscribeInput[] = [];
  private readonly words: (input: TranscribeInput) => TranscriptWord[];
  constructor(words: (input: TranscribeInput) => TranscriptWord[]) {
    this.words = words;
  }
  async transcribe(input: TranscribeInput) {
    this.calls.push(input);
    return { words: this.words(input) };
  }
}

let h: WorkerHarness;
beforeAll(async () => {
  h = await createWorkerHarness();
});
afterAll(async () => {
  await h?.close();
});

async function chunksOf(sourceId: string) {
  const rows = await h.db.pool.query<{ locator: any; text: string; anchor_page: number }>("SELECT locator, text, anchor_page FROM chunks WHERE source_id = $1 ORDER BY sequence", [sourceId]);
  return rows.rows;
}

describe("audio uploads (FR-SI-01, Gate v3.0 #1)", () => {
  it("MEDIA-01: the 10-minute Interview.mp3 becomes Ready; every chunk has a valid time_span and the 04:15 statement starts its own chunk", async () => {
    const asr = new FixtureTranscriber(() => interviewWords());
    const { outcome, source } = await h.ingest({ name: "Interview.mp3", bytes: interviewMp3(), mediaType: "audio/mpeg", deps: { adapters: { audio: createAudioAdapter({ transcriber: asr }) } } });
    expect(outcome.status).toBe("ready");
    expect(asr.calls[0]!.object).toEqual({ name: source.object_name, generation: source.object_generation });
    const chunks = await chunksOf(source.id);
    let last = -1;
    for (const c of chunks) {
      const loc = TimeSpanLocatorSchema.parse(c.locator);
      expect(Object.keys(c.locator).sort()).toEqual(["end_ms", "start_ms"]);
      expect(loc.start_ms).toBeGreaterThanOrEqual(last);
      expect(loc.end_ms).toBeLessThanOrEqual(INTERVIEW_DURATION_MS);
      last = loc.start_ms;
    }
    const cited = chunks.find((c) => c.text.includes(INTERVIEW_CITED_STATEMENT))!;
    expect(cited.locator.start_ms).toBe(INTERVIEW_CITED_MS);
    const pages = await h.db.pool.query("SELECT page_number, start_ms, end_ms, text FROM source_pages WHERE source_id = $1 AND page_number = $2", [source.id, cited.anchor_page]);
    expect(pages.rows[0]).toMatchObject({ start_ms: INTERVIEW_CITED_MS });
    const rev = await h.db.pool.query("SELECT viewer_kind, media_object_name, media_object_generation, player FROM source_revisions WHERE source_id = $1", [source.id]);
    expect(rev.rows[0]).toMatchObject({ viewer_kind: "transcript", media_object_name: source.object_name, media_object_generation: source.object_generation, player: { type: "audio" } });
  });

  it("MEDIA-02: WAV durations come from the header; a provider word beyond the duration is rejected, not clamped", async () => {
    expect(wavDurationMs(shortWav(30_000))).toBe(30_000);
    const ok = new FixtureTranscriber(() => [{ text: "Hello.", start_ms: 0, end_ms: 900 }, { text: "Depot", start_ms: 1000, end_ms: 1500 }]);
    expect((await h.ingest({ name: "ok.wav", bytes: shortWav(), mediaType: "audio/wav", deps: { adapters: { audio: createAudioAdapter({ transcriber: ok }) } } })).source.status).toBe("Ready");
    const beyond = new FixtureTranscriber(() => [{ text: "Late", start_ms: 29_000, end_ms: 31_000 }]);
    const { source } = await h.ingest({ name: "late.wav", bytes: shortWav(), mediaType: "audio/wav", deps: { adapters: { audio: createAudioAdapter({ transcriber: beyond }) } } });
    expect(source).toMatchObject({ status: "Failed", failure_code: "InvalidTranscriptTiming" });
  });

  it("MEDIA-03: non-monotonic, negative or reversed provider timings fail; M4A is accepted", async () => {
    for (const words of [
      [{ text: "b", start_ms: 5000, end_ms: 5200 }, { text: "a", start_ms: 1000, end_ms: 1200 }],
      [{ text: "x", start_ms: 2000, end_ms: 1000 }],
      [{ text: "x", start_ms: -5, end_ms: 10 }],
    ]) {
      const { source } = await h.ingest({ name: "bad.m4a", bytes: m4aFixture(), mediaType: "audio/mp4", deps: { adapters: { audio: createAudioAdapter({ transcriber: new FixtureTranscriber(() => words) }) } } });
      expect(source.failure_code).toBe("InvalidTranscriptTiming");
    }
    const { source } = await h.ingest({ name: "memo.m4a", bytes: m4aFixture(), mediaType: "audio/mp4", deps: { adapters: { audio: createAudioAdapter({ transcriber: new FixtureTranscriber(() => interviewWords().slice(0, 30)) }) } } });
    expect(source.status).toBe("Ready");
  });

  it("MEDIA-04: provider offsets are parsed to integer milliseconds; segmented transcripts use absolute offsets and drop overlap duplicates", () => {
    expect(parseProviderOffset("1.2345s")).toBe(1235);
    expect(parseProviderOffset("255s")).toBe(255000);
    expect(parseProviderOffset({ seconds: "4", nanos: 500_000_000 })).toBe(4500);
    expect(parseProviderOffset(undefined)).toBe(0);
    const words = assembleSegments([
      { offsetMs: 0, words: [{ text: "one", start_ms: 0, end_ms: 400 }, { text: "two", start_ms: 29_600, end_ms: 30_100 }] },
      { offsetMs: 29_500, words: [{ text: "two", start_ms: 100, end_ms: 600 }, { text: "three", start_ms: 1000, end_ms: 1400 }] },
    ]);
    expect(words).toEqual([
      { text: "one", start_ms: 0, end_ms: 400 },
      { text: "two", start_ms: 29_600, end_ms: 30_100 },
      { text: "three", start_ms: 30_500, end_ms: 30_900 },
    ]);
  });
});

describe("video URLs (FR-SI-01, NFR-SEC-02)", () => {
  const resolver = { lookup: async () => [{ address: "93.184.216.34", family: 4 }] };
  function site(pages: Record<string, { type: string; body: string | Buffer }>): Transport & { urls: string[] } {
    const urls: string[] = [];
    return {
      urls,
      async request(req) {
        urls.push(req.url.toString());
        const page = pages[req.url.toString()];
        if (!page) return { status: 404, headers: {}, body: (async function* () { yield Buffer.from("no"); })() };
        return { status: 200, headers: { "content-type": page.type }, body: (async function* () { yield Buffer.from(page.body); })() };
      },
    };
  }

  async function importVideo(url: string, transport: Transport, asr: Transcriber = new FixtureTranscriber(() => [])) {
    const nb = await h.newNotebook();
    const admitted = await admitLinkedImport(h.db.pool, h.ownerId, nb, { attempt_id: randomUUID(), kind: "video", url });
    await processIngestJob(
      {
        pool: h.db.pool,
        storage: h.storage,
        embedder: h.embedder,
        ocr: new FixtureOcr(),
        adapters: { video: createVideoAdapter({ transcriber: asr, storage: h.storage, web: { resolver, transport, policy: { privateNetworks: [], allowedPrivateHosts: [] } } }) },
        screener: { name: "clean", screen: async () => ({ verdict: "clean" }) },
      },
      { source_id: admitted.source.id, attempt_id: admitted.source.attempt_id, operation_id: admitted.operation.operation_id },
      8
    );
    return (await getSourceById(h.db.pool, admitted.source.id))!;
  }

  it("MEDIA-05: WebVTT cues parse to integer intervals with markup stripped", () => {
    const cues = parseWebVtt(`${VIDEO_CAPTIONS_VTT}\n00:01:12.000 --> 00:01:14.500 align:start\n<v Speaker>Use the <b>green</b> exit.</v>\n`);
    expect(cues[0]).toEqual({ start_ms: 0, end_ms: 4500, text: "Welcome to the depot safety briefing." });
    expect(cues[2]).toEqual({ start_ms: 65_000, end_ms: 70_000, text: "Report damaged pallets to the shift supervisor immediately." });
    expect(cues[3]).toEqual({ start_ms: 72_000, end_ms: 74_500, text: "Use the green exit." });
  });

  it("FR-SI-01 / NFR-SEC-02: caption entities decode exactly once and markup is parsed inertly", () => {
    const cues = parseWebVtt("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<b>Text</b> &amp;lt;script&amp;gt; &lt;literal&gt; &amp; &nbsp; end");
    expect(cues[0]?.text).toBe("Text &lt;script&gt; <literal> & end");
  });

  it("MEDIA-06: an enterprise page with an accessible caption track becomes Ready with time_span chunks and a link player", async () => {
    const t = site({
      "https://media.example.test/v/42": { type: "text/html", body: videoPageHtml("/v/42/captions.vtt") },
      "https://media.example.test/v/42/captions.vtt": { type: "text/vtt", body: VIDEO_CAPTIONS_VTT },
    });
    const source = await importVideo("https://media.example.test/v/42", t);
    expect(source).toMatchObject({ status: "Ready", media_type: "video_url", link_kind: "video", title: "Depot safety briefing" });
    for (const c of await chunksOf(source.id)) TimeSpanLocatorSchema.parse(c.locator);
    expect(t.urls).toEqual(["https://media.example.test/v/42", "https://media.example.test/v/42/captions.vtt"]);
  });

  it("MEDIA-07: without captions, an accessible audio/video stream is downloaded (bounded) and transcribed", async () => {
    const asr = new FixtureTranscriber(() => [{ text: "Safety first.", start_ms: 0, end_ms: 1200 }]);
    const t = site({
      "https://media.example.test/v/7": { type: "text/html", body: videoPageHtml(null, "/v/7/stream.mp4") },
      "https://media.example.test/v/7/stream.mp4": { type: "video/mp4", body: m4aFixture() },
    });
    const source = await importVideo("https://media.example.test/v/7", t, asr);
    expect(source.status).toBe("Ready");
    expect(asr.calls[0]!.object.name).toContain(`/sources/${source.id}/media/`);
    // T056 (FR-005): the stored stream is the seekable player (served only through the authorized media proxy).
    const rev = await h.db.pool.query("SELECT player, media_object_name FROM source_revisions WHERE source_id = $1", [source.id]);
    expect(rev.rows[0].player).toEqual({ type: "video" });
    expect(rev.rows[0].media_object_name).toBe(asr.calls[0]!.object.name);
  });

  it("MEDIA-08: no captions and no accessible audio — including public YouTube without delegated caption access — fails with the exact message", async () => {
    const t = site({ "https://media.example.test/v/none": { type: "text/html", body: videoPageHtml(null) } });
    expect(await importVideo("https://media.example.test/v/none", t)).toMatchObject({ status: "Failed", failure_message: NO_TRANSCRIPT_MESSAGE });
    const yt = site({});
    expect(await importVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ", yt)).toMatchObject({ status: "Failed", failure_message: NO_TRANSCRIPT_MESSAGE });
    expect(yt.urls).toEqual([]);
  });
});
