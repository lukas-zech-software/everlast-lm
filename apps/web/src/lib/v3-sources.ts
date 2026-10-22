/**
 * Browser mirrors of package 3.1 helpers (FR-SI-01, FR-SI-04, FR-SI-05; specs/009). The SPA has no bundler and
 * imports contracts as types only, so these small pure functions are mirrored and checked for parity against
 * `packages/contracts/src/package-v3-1.ts` in apps/web/test/v3-sources.test.ts.
 */

export type SourceKind = "pdf" | "text" | "markdown" | "pasted" | "note" | "docx" | "pptx" | "audio" | "web" | "video";

export const UPLOAD_ACCEPT =
  ".pdf,.txt,.md,.markdown,.docx,.pptx,.mp3,.wav,.m4a,application/pdf,text/plain,text/markdown," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation,audio/mpeg,audio/wav,audio/mp4";

export function sourceKind(source: { media_type: string; link_kind?: string | null | undefined }): SourceKind {
  if (source.link_kind === "web") return "web";
  if (source.link_kind === "video" || source.media_type === "video_url") return "video";
  switch (source.media_type) {
    case "application/pdf":
      return "pdf";
    case "text/markdown":
      return "markdown";
    case "copied_text":
      return "pasted";
    case "note_markdown":
      return "note";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return "pptx";
    case "audio/mpeg":
    case "audio/wav":
    case "audio/mp4":
      return "audio";
    case "text/html":
      return "web";
    default:
      return "text";
  }
}

/** Format icons of the Left Panel (Doc, Slides, Audio waveform, Video play, Web globe). */
export const KIND_ICONS: Record<SourceKind, string> = {
  pdf: "📄",
  text: "📝",
  markdown: "📝",
  pasted: "📋",
  note: "🗒️",
  docx: "📘",
  pptx: "📙",
  audio: "🎧",
  web: "🌐",
  video: "▶️",
};

export function isSyncEligible(linkKind: string | null | undefined): boolean {
  return linkKind === "web" || linkKind === "drive";
}

export function parseGoogleDocumentLink(link: string): { id: string; kind: "document" | "presentation" } | null {
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null;
    const m = /^\/(document|presentation)\/d\/([A-Za-z0-9_-]{1,256})(?:\/|$)/.exec(url.pathname);
    return m ? { id: m[2]!, kind: m[1] as "document" | "presentation" } : null;
  } catch {
    return null;
  }
}

export function formatDisplayTime(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError("display time requires a non-negative integer millisecond offset");
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Rename limit: 1–200 Unicode code points after trimming (FR-SI-05). */
export function validRenameTitle(title: string): boolean {
  const n = Array.from(title.trim()).length;
  return n >= 1 && n <= 200;
}
