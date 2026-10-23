import { GoogleAuth } from "google-auth-library";
import { parseHtml } from "./dom.ts";
import { NO_TRANSCRIPT_MESSAGE } from "@everlast/contracts";
import type { ObjectStorage } from "@everlast/cloud";
import { IngestionFailure, MSG_NO_TEXT, type CanonicalDocument, type CanonicalPage } from "./extract.ts";
import { guardedFetch, SsrfBlockedError, type WebAdapterOptions } from "./web.ts";
import { sourceObjectPrefix, type NormalizedSource, type SourceAdapter } from "./pipeline.ts";

/** Optional everlast-render audio preprocessing (M4A/MP4 → FLAC) ahead of Speech V2. */
export interface AudioPreprocessor {
  audioToFlac(input: { name: string; generation: string }, format: "mp3" | "wav" | "m4a"): Promise<{ name: string; generation: string }>;
}

/**
 * Audio and video ingestion (FR-SI-01 Subset B, FR-SI-04, C-01, Gate v3.0 #1; specs/009 T029).
 *
 * Audio uploads (MP3/WAV/M4A) and video URLs without captions are transcribed by Speech-to-Text V2 (Chirp 2, word
 * offsets, europe-west4; no silent region/model fallback). Accessible caption tracks (WebVTT) are used directly.
 * Words/cues become transcript segments (canonical `source_pages` rows with integer [start_ms, end_ms]); every
 * chunk carries the strict C-01 `time_span`. Provider timings are validated (integer, monotonic, within duration)
 * and rejected — never clamped — when invalid. A public YouTube page does not grant caption/audio access: without
 * an accessible track or stream the import fails with "No transcript available for this video".
 */

export interface TranscriptWord {
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface TranscribeInput {
  object: { name: string; generation: string };
  mediaType: string;
  durationMs: number | null;
}

export interface Transcriber {
  readonly name: string;
  transcribe(input: TranscribeInput): Promise<{ words: TranscriptWord[]; durationMs?: number | null }>;
}

const invalidTiming = () => new IngestionFailure("InvalidTranscriptTiming", "The transcript timing was invalid; the source was not indexed");
const noTranscript = () => new IngestionFailure("NoTranscript", NO_TRANSCRIPT_MESSAGE);

/** Provider offsets ("1.234s" or {seconds, nanos}) → integer milliseconds. */
export function parseProviderOffset(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "string") {
    const m = /^(-?\d+(?:\.\d+)?)s$/.exec(value.trim());
    if (!m) throw invalidTiming();
    return Math.round(Number(m[1]) * 1000);
  }
  if (typeof value === "object") {
    const v = value as { seconds?: string | number; nanos?: number };
    return Math.round(Number(v.seconds ?? 0) * 1000 + Number(v.nanos ?? 0) / 1e6);
  }
  throw invalidTiming();
}

/** Absolute offsets for segmented transcription; words repeated in an overlap window are dropped deterministically. */
export function assembleSegments(segments: { offsetMs: number; words: TranscriptWord[] }[]): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const seg of [...segments].sort((a, b) => a.offsetMs - b.offsetMs)) {
    for (const w of seg.words) {
      const abs = { text: w.text, start_ms: w.start_ms + seg.offsetMs, end_ms: w.end_ms + seg.offsetMs };
      const last = out.at(-1);
      if (last && abs.start_ms < last.end_ms) {
        const dupe = out.slice(-8).some((p) => p.text.toLowerCase() === abs.text.toLowerCase() && Math.abs(p.start_ms - abs.start_ms) <= 1000);
        if (dupe) continue;
      }
      out.push(abs);
    }
  }
  return out;
}

export function validateWords(words: TranscriptWord[], durationMs: number | null): void {
  let last = 0;
  for (const w of words) {
    if (!Number.isSafeInteger(w.start_ms) || !Number.isSafeInteger(w.end_ms) || w.start_ms < 0 || w.end_ms < w.start_ms || w.start_ms < last) throw invalidTiming();
    if (durationMs !== null && w.end_ms > durationMs) throw invalidTiming();
    last = w.start_ms;
  }
}

const SEGMENT_MAX_WORDS = 40;
const SEGMENT_MAX_MS = 30_000;
const PAUSE_MS = 1500;

/** Words → transcript segments: sentence ends, long pauses or size bounds start a new segment. */
export function wordsToTranscript(words: TranscriptWord[]): CanonicalDocument {
  const pages: CanonicalPage[] = [];
  let group: TranscriptWord[] = [];
  const flush = () => {
    if (!group.length) return;
    const text = group.map((w) => w.text.trim()).filter(Boolean).join(" ");
    if (text) pages.push({ page_number: pages.length + 1, text, sections: [[0, text.length]], start_ms: group[0]!.start_ms, end_ms: group.at(-1)!.end_ms });
    group = [];
  };
  for (const w of words) {
    const last = group.at(-1);
    if (last && (w.start_ms - last.end_ms > PAUSE_MS || group.length >= SEGMENT_MAX_WORDS || w.end_ms - group[0]!.start_ms > SEGMENT_MAX_MS)) flush();
    group.push(w);
    if (/[.!?…]["')\]]?$/.test(w.text)) flush();
  }
  flush();
  return { pages, pageCount: pages.length, ocrPages: [] };
}

// ---------------------------------------------------------------------------------------------------------
// Captions (WebVTT)
// ---------------------------------------------------------------------------------------------------------

function vttTime(value: string): number {
  const m = /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(value.trim());
  if (!m) throw invalidTiming();
  return (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

export function parseWebVtt(text: string): { start_ms: number; end_ms: number; text: string }[] {
  const body = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!/^WEBVTT/.test(body)) throw noTranscript();
  const cues: { start_ms: number; end_ms: number; text: string }[] = [];
  for (const block of body.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const timing = lines.findIndex((l) => l.includes("-->"));
    if (timing < 0) continue;
    const [from, to] = lines[timing]!.split("-->");
    const start = vttTime(from!);
    const end = vttTime(to!.trim().split(/\s+/)[0]!);
    if (end < start) throw invalidTiming();
    const cueText = lines
      .slice(timing + 1)
      .join(" ")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    if (cueText) cues.push({ start_ms: start, end_ms: end, text: cueText });
  }
  cues.sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
  return cues;
}

export function cuesToTranscript(cues: { start_ms: number; end_ms: number; text: string }[]): CanonicalDocument {
  const pages: CanonicalPage[] = cues.map((c, i) => ({ page_number: i + 1, text: c.text, sections: [[0, c.text.length]], start_ms: c.start_ms, end_ms: c.end_ms }));
  return { pages, pageCount: pages.length, ocrPages: [] };
}

// ---------------------------------------------------------------------------------------------------------
// Container durations
// ---------------------------------------------------------------------------------------------------------

/** Duration of a PCM WAV from its header (null when the header is not a canonical RIFF/WAVE). */
export function wavDurationMs(bytes: Buffer): number | null {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === "fmt ") byteRate = bytes.readUInt32LE(offset + 16);
    if (id === "data") return byteRate > 0 ? Math.round((size / byteRate) * 1000) : null;
    offset += 8 + size + (size % 2);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------------------------------------

const RENDER_FORMAT: Record<string, string> = { "audio/mpeg": "mp3", "audio/wav": "wav", "audio/mp4": "m4a" };

async function transcribeObject(
  transcriber: Transcriber,
  object: { name: string; generation: string },
  mediaType: string,
  durationMs: number | null,
  preprocessor?: AudioPreprocessor | undefined
): Promise<{ doc: CanonicalDocument; durationMs: number | null }> {
  // M4A/MP4 audio is normalized to FLAC by everlast-render when configured (Speech V2 auto-decoding coverage).
  const input = preprocessor && mediaType === "audio/mp4" ? await preprocessor.audioToFlac(object, "m4a") : object;
  const result = await transcriber.transcribe({ object: input, mediaType, durationMs });
  const duration = durationMs ?? result.durationMs ?? null;
  validateWords(result.words, duration);
  const doc = wordsToTranscript(result.words);
  if (doc.pages.length === 0) throw new IngestionFailure("NoExtractableText", MSG_NO_TEXT);
  return { doc, durationMs: duration ?? result.words.at(-1)?.end_ms ?? null };
}

export interface AudioAdapterOptions {
  transcriber: Transcriber;
  preprocessor?: AudioPreprocessor | undefined;
}

/** `.mp3` / `.wav` / `.m4a` uploads: ASR over the exact received object generation. */
export function createAudioAdapter(options: AudioAdapterOptions): SourceAdapter {
  return async (ctx): Promise<NormalizedSource> => {
    const bytes = await ctx.readUpload();
    if (!ctx.source.object_name || !ctx.source.object_generation) throw new IngestionFailure("Unreadable", "Could not read file (password-protected or corrupted)");
    await ctx.progress("Transcribing");
    const object = { name: ctx.source.object_name, generation: ctx.source.object_generation };
    const declaredDuration = ctx.source.media_type === "audio/wav" ? wavDurationMs(bytes) : null;
    const { doc, durationMs } = await transcribeObject(options.transcriber, object, ctx.source.media_type, declaredDuration, options.preprocessor);
    return {
      doc,
      viewerKind: "transcript",
      byteSize: bytes.length,
      screen: false,
      mediaDurationMs: durationMs,
      mediaObject: object,
      player: { type: "audio" },
    };
  };
}

export interface VideoAdapterOptions {
  transcriber: Transcriber;
  preprocessor?: AudioPreprocessor | undefined;
  web: WebAdapterOptions;
  storage: ObjectStorage;
}

export function youtubeVideoId(link: string): string | null {
  try {
    const url = new URL(link);
    const host = url.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return /^[A-Za-z0-9_-]{6,20}$/.test(url.pathname.slice(1)) ? url.pathname.slice(1) : null;
    if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
    const id = url.searchParams.get("v") ?? /^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{6,20})/.exec(url.pathname)?.[1] ?? null;
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

const MEDIA_TYPES = /^(audio|video)\//;

/**
 * Video URLs: (1) a direct WebVTT track, (2) an HTML page with an accessible `<track kind=captions|subtitles>`,
 * (3) an accessible audio/video stream (page `<video>/<audio>/<source>` or a direct media URL) downloaded through the
 * same SSRF guard and transcribed. YouTube watch pages expose neither without delegated caption permission, so they
 * fail with "No transcript available for this video" without any request to YouTube.
 */
export function createVideoAdapter(options: VideoAdapterOptions): SourceAdapter {
  const fetchGuarded = async (url: string) => {
    try {
      return await guardedFetch(url, { ...options.web, principalAuthorized: true });
    } catch (err) {
      if (err instanceof IngestionFailure) throw err;
      if (err instanceof SsrfBlockedError) throw new IngestionFailure("DestinationBlocked", "This URL points to a network destination that cannot be imported");
      throw noTranscript();
    }
  };

  return async (ctx): Promise<NormalizedSource> => {
    const url = ctx.source.external_url;
    if (!url) throw noTranscript();
    const ytId = youtubeVideoId(url);
    if (ytId) throw noTranscript();
    await ctx.progress("Fetching");
    const page = await fetchGuarded(url);
    if (page.status < 200 || page.status >= 300) throw noTranscript();
    const player = { type: "link", url };
    const captions = async (vtt: Buffer, title?: string): Promise<NormalizedSource> => {
      const doc = cuesToTranscript(parseWebVtt(vtt.toString("utf8")));
      if (doc.pages.length === 0) throw noTranscript();
      return { doc, viewerKind: "transcript", byteSize: vtt.length, screen: true, title, player, mediaDurationMs: doc.pages.at(-1)!.end_ms ?? null };
    };
    const media = async (bytes: Buffer, contentType: string, title?: string): Promise<NormalizedSource> => {
      const mediaType = contentType.startsWith("audio/mpeg") ? "audio/mpeg" : contentType.startsWith("audio/wav") || contentType.startsWith("audio/x-wav") ? "audio/wav" : "audio/mp4";
      const written = await options.storage.write(`${sourceObjectPrefix(ctx.source)}media/${Date.now()}.${RENDER_FORMAT[mediaType]}`, bytes, mediaType);
      await ctx.progress("Transcribing");
      const object = { name: written.name, generation: written.generation };
      const { doc, durationMs } = await transcribeObject(options.transcriber, object, mediaType, mediaType === "audio/wav" ? wavDurationMs(bytes) : null, options.preprocessor);
      // T056 (FR-005): the stored stream is the seekable player, served only through the authorized media proxy.
      return { doc, viewerKind: "transcript", byteSize: bytes.length, screen: true, title, player: { type: "video" }, mediaDurationMs: durationMs, mediaObject: object };
    };

    if (page.contentType.startsWith("text/vtt")) return captions(page.body);
    if (MEDIA_TYPES.test(page.contentType)) return media(page.body, page.contentType);
    if (!/^(text\/html|application\/xhtml\+xml)/.test(page.contentType)) throw noTranscript();

    const document = parseHtml(page.body.toString("utf8"), page.finalUrl);
    const title = document.title?.replace(/\s+/g, " ").trim() || undefined;
    const track = document.querySelector('track[kind="captions"][src], track[kind="subtitles"][src], track:not([kind])[src]');
    if (track) {
      const vtt = await fetchGuarded(new URL(track.getAttribute("src")!, page.finalUrl).toString());
      if (vtt.status >= 200 && vtt.status < 300) return captions(vtt.body, title);
    }
    const src = document.querySelector("video[src], audio[src]")?.getAttribute("src") ?? document.querySelector("video source[src], audio source[src]")?.getAttribute("src");
    if (src) {
      const stream = await fetchGuarded(new URL(src, page.finalUrl).toString());
      if (stream.status >= 200 && stream.status < 300 && MEDIA_TYPES.test(stream.contentType)) return media(stream.body, stream.contentType, title);
    }
    throw noTranscript();
  };
}

// ---------------------------------------------------------------------------------------------------------
// Speech-to-Text V2 (Chirp 2) — production transcriber
// ---------------------------------------------------------------------------------------------------------

export interface SpeechConfig {
  projectId: string;
  location: string;
  bucket: string;
  model?: string;
  languageCodes?: string[];
  pollMs?: number;
  timeoutMs?: number;
  request?: (req: { url: string; method: "GET" | "POST"; data?: unknown }) => Promise<unknown>;
}

export function speechConfigFromEnv(env: NodeJS.ProcessEnv, _storage: ObjectStorage): SpeechConfig | null {
  const location = env.SPEECH_LOCATION;
  const projectId = env.GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT;
  const bucket = env.GCS_WORKSPACE_BUCKET ?? env.STORAGE_BUCKET;
  if (!location || !projectId || !bucket) return null;
  return { projectId, location, bucket, languageCodes: (env.SPEECH_LANGUAGE_CODES ?? "auto").split(",").map((l) => l.trim()).filter(Boolean) };
}

interface BatchOperation {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: {
    results?: Record<string, { error?: unknown; inlineResult?: { transcript?: { results?: { alternatives?: { words?: { word?: string; startOffset?: unknown; endOffset?: unknown }[] }[] }[] } } }>;
  };
}

/** Speech V2 `batchRecognize` with Chirp 2 word offsets in the configured EU location (no fallback). */
export class SpeechV2Transcriber implements Transcriber {
  readonly name = "speech-v2-chirp2";
  private readonly config: SpeechConfig;
  private readonly auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

  constructor(config: SpeechConfig) {
    if (!/^europe-|^eu$/.test(config.location)) throw new Error("Speech-to-Text must run in an EU location (D3)");
    this.config = config;
  }

  private async call(url: string, method: "GET" | "POST", data?: unknown): Promise<BatchOperation> {
    if (this.config.request) return (await this.config.request({ url, method, ...(data !== undefined ? { data } : {}) })) as BatchOperation;
    const client = await this.auth.getClient();
    return (await client.request<BatchOperation>({ url, method, ...(data !== undefined ? { data } : {}) })).data;
  }

  async transcribe(input: TranscribeInput): Promise<{ words: TranscriptWord[] }> {
    const { projectId, location, bucket } = this.config;
    const host = `https://${location}-speech.googleapis.com/v2`;
    const uri = `gs://${bucket}/${input.object.name}`;
    let op = await this.call(`${host}/projects/${projectId}/locations/${location}/recognizers/_:batchRecognize`, "POST", {
      config: {
        model: this.config.model ?? "chirp_2",
        languageCodes: this.config.languageCodes ?? ["auto"],
        features: { enableWordTimeOffsets: true, enableAutomaticPunctuation: true },
        autoDecodingConfig: {},
      },
      files: [{ uri }],
      recognitionOutputConfig: { inlineResponseConfig: {} },
    });
    const deadline = Date.now() + (this.config.timeoutMs ?? 600_000);
    while (!op.done) {
      if (Date.now() > deadline || !op.name) throw new Error("Speech batch recognition timed out");
      await new Promise((r) => setTimeout(r, this.config.pollMs ?? 1000));
      op = await this.call(`${host}/${op.name}`, "GET");
    }
    if (op.error) throw new Error("Speech batch recognition failed");
    const result = op.response?.results?.[uri];
    if (!result || result.error) throw new Error("Speech batch recognition failed for the file");
    const words: TranscriptWord[] = [];
    for (const r of result.inlineResult?.transcript?.results ?? []) {
      for (const w of r.alternatives?.[0]?.words ?? []) {
        if (!w.word) continue;
        words.push({ text: w.word, start_ms: parseProviderOffset(w.startOffset), end_ms: parseProviderOffset(w.endOffset) });
      }
    }
    return { words };
  }
}
