import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UUID_V7_REGEX } from "@everlast/contracts";
import {
  fixtureDigests,
  INTERVIEW_CITED_MS,
  INTERVIEW_DURATION_MS,
  interviewWords,
  MULTIMODAL_FIXTURE_VERSION,
  SYMBOLIC_IDS,
} from "../src/fixtures/multimodal-ingestion.ts";

/** [009-multimodal-ingestion-sync] T002 — versioned synthetic fixtures match their manifest (FR-SI-01/05, C-01). */

const manifest = JSON.parse(readFileSync(new URL("../fixtures/v3-multimodal/manifest.json", import.meta.url), "utf8")) as {
  version: string;
  sha256: Record<string, string>;
  symbolic_ids: Record<string, string>;
};

describe("v3 multimodal fixtures (T002)", () => {
  it("FX-01: every fixture digest equals the versioned manifest", () => {
    expect(manifest.version).toBe(MULTIMODAL_FIXTURE_VERSION);
    expect(fixtureDigests()).toEqual(manifest.sha256);
  });

  it("FX-02: symbolic chunk IDs map to schema-valid UUIDv7 values", () => {
    expect(manifest.symbolic_ids).toEqual(SYMBOLIC_IDS);
    for (const [key, id] of Object.entries(SYMBOLIC_IDS)) if (key.startsWith("chk_")) expect(id).toMatch(UUID_V7_REGEX);
  });

  it("FX-03: Interview.mp3 words are integer, monotonic, within 10 minutes and include the 04:15 statement", () => {
    const words = interviewWords();
    let last = -1;
    for (const w of words) {
      expect(Number.isInteger(w.start_ms) && Number.isInteger(w.end_ms)).toBe(true);
      expect(w.start_ms).toBeGreaterThanOrEqual(last);
      expect(w.end_ms).toBeGreaterThanOrEqual(w.start_ms);
      expect(w.end_ms).toBeLessThanOrEqual(INTERVIEW_DURATION_MS);
      last = w.start_ms;
    }
    expect(words.some((w) => w.start_ms === INTERVIEW_CITED_MS)).toBe(true);
  });
});
