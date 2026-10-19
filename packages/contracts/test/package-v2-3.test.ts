import { describe, it, expect } from "vitest";
import {
  CreateNoteInputSchema,
  PatchNoteInputSchema,
  NoteAssistantInputSchema,
  ConvertToSourceInputSchema,
  SaveNoteFromMessageInputSchema,
  sanitizeNoteMarkdown,
  countNoteWords,
  noteSourceTitle,
  DEFAULT_NOTE_TITLE,
  NOTE_TITLE_MAX_CODE_POINTS,
  NOTE_BODY_MAX_WORDS,
} from "@everlast/contracts";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("FR-NM-01: note field bounds", () => {
  it("defaults the title and trims outer whitespace", () => {
    expect(DEFAULT_NOTE_TITLE).toBe("New note");
    expect(PatchNoteInputSchema.parse({ title: "  Key Audit Findings  " }).title).toBe("Key Audit Findings");
  });

  it("accepts 200 and rejects 201 title code points and an empty title", () => {
    expect(PatchNoteInputSchema.safeParse({ title: "😀".repeat(NOTE_TITLE_MAX_CODE_POINTS) }).success).toBe(true);
    expect(PatchNoteInputSchema.safeParse({ title: "😀".repeat(NOTE_TITLE_MAX_CODE_POINTS + 1) }).success).toBe(false);
    expect(PatchNoteInputSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("accepts exactly 100,000 words and rejects 100,001", () => {
    const body = (n: number) => Array.from({ length: n }, () => "w").join(" ");
    expect(PatchNoteInputSchema.safeParse({ content_md: body(NOTE_BODY_MAX_WORDS) }).success).toBe(true);
    expect(PatchNoteInputSchema.safeParse({ content_md: body(NOTE_BODY_MAX_WORDS + 1) }).success).toBe(false);
    expect(CreateNoteInputSchema.parse({}).title).toBe("New note");
  });
});

describe("FR-NM-01: sanitizer", () => {
  it("strips scripts and raw HTML and unsafe link schemes but keeps Markdown", () => {
    const out = sanitizeNoteMarkdown(
      "## H\n<script>alert(1)</script>**b** <img src=x onerror=1>[x](javascript:alert(1)) [ok](https://a.example)"
    );
    expect(out).not.toMatch(/script|onerror|<img|javascript:/i);
    expect(out).toContain("## H");
    expect(out).toContain("**b**");
    expect(out).toContain("[ok](https://a.example)");
  });
});

describe("FR-NM-03: titles and word counting", () => {
  it("clamps a single-note source title to 100 code points", () => {
    expect(Array.from(noteSourceTitle(["😀".repeat(150)])).length).toBe(100);
    expect(noteSourceTitle(["A", "B"])).toBe("Combined notes");
    expect(noteSourceTitle(["Only"])).toBe("Only");
  });
  it("counts words", () => {
    expect(countNoteWords("  a  b\nc ")).toBe(3);
    expect(countNoteWords("   ")).toBe(0);
  });
  it("validates convert inputs", () => {
    expect(ConvertToSourceInputSchema.safeParse({ note_ids: [uuid(1)] }).success).toBe(true);
    expect(ConvertToSourceInputSchema.safeParse({ all: true }).success).toBe(true);
    expect(ConvertToSourceInputSchema.safeParse({}).success).toBe(false);
    expect(ConvertToSourceInputSchema.safeParse({ note_ids: [] }).success).toBe(false);
  });
  it("validates save-from-message input", () => {
    expect(SaveNoteFromMessageInputSchema.safeParse({ message_id: uuid(2) }).success).toBe(true);
    expect(SaveNoteFromMessageInputSchema.safeParse({ message_id: "x" }).success).toBe(false);
  });
});

describe("FR-NM-04: assistant input", () => {
  const base = { action_type: "summarize", selected_source_ids: [] as string[] };
  it("accepts 1 and 50 notes, rejects 0 and 51", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => uuid(i + 1));
    expect(NoteAssistantInputSchema.safeParse({ ...base, selected_note_ids: ids(1) }).success).toBe(true);
    expect(NoteAssistantInputSchema.safeParse({ ...base, selected_note_ids: ids(50) }).success).toBe(true);
    expect(NoteAssistantInputSchema.safeParse({ ...base, selected_note_ids: [] }).success).toBe(false);
    expect(NoteAssistantInputSchema.safeParse({ ...base, selected_note_ids: ids(51) }).success).toBe(false);
  });
  it("rejects unknown actions", () => {
    expect(NoteAssistantInputSchema.safeParse({ action_type: "rewrite", selected_note_ids: [uuid(1)], selected_source_ids: [] }).success).toBe(false);
  });
});

describe("sanitizeNoteMarkdown hardening (FR-NM-01, CodeQL js/incomplete-multi-character-sanitization)", () => {
  it.each([
    ["<scr<script>ipt>alert(1)</script>", /<script|<img/i],
    ["<<script>script>alert(1)</script>", /<script/i],
    ["<script>never closed", /<script|never closed/i],
    ["<img src=x onerror=alert(1)", /<img/i],
    ["<STYLE>b{}</STYLE>ok", /style|b\{\}/i],
    ["<<b>script>alert(1)<</b>/script>", /<script|<\/script/i],
    ["<[img](javascript:x) src=x onerror=alert(1)>", /<img|onerror/i],
    ["<[a](data:x)img src=x onerror=alert(1)>", /<aimg|<img|onerror/i],
  ])("leaves no tag in %j", (input, forbidden) => {
    expect(sanitizeNoteMarkdown(input)).not.toMatch(forbidden);
  });

  it("keeps ordinary text, comparisons and Markdown", () => {
    expect(sanitizeNoteMarkdown("a < b and 3<4\n**bold** [ok](https://a.example)")).toBe(
      "a < b and 3<4\n**bold** [ok](https://a.example)"
    );
  });
});
