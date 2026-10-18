import { describe, it, expect } from "vitest";
import {
  MAX_NOTEBOOKS_PER_USER,
  DEFAULT_MAX_SOURCES_PER_NOTEBOOK,
  MIN_CONFIGURABLE_SOURCES_PER_NOTEBOOK,
  MAX_CONFIGURABLE_SOURCES_PER_NOTEBOOK,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_WORDS,
  SourceLimitsConfigSchema,
  SourceAdmissionAttemptSchema,
  parseSourceLimitsConfig,
  isAdmissionAllowedUnderConfig,
  QuotaSummarySchema,
} from "../src/source-admission.js";

describe("T032 [US3] Quota DTO and Configuration Contract (FR-WM-07)", () => {
  it("ADM-01: valid source limit between 50 and 300 is accepted, defaults to 50", () => {
    const defaultConfig = parseSourceLimitsConfig({});
    expect(defaultConfig.maxSourcesPerNotebook).toBe(50);
    expect(defaultConfig.maxNotebooksPerUser).toBe(100);
    expect(defaultConfig.maxBytesPerSource).toBe(200_000_000);
    expect(defaultConfig.maxWordsPerSource).toBe(500_000);

    const minConfig = parseSourceLimitsConfig({ maxSourcesPerNotebook: 50 });
    expect(minConfig.maxSourcesPerNotebook).toBe(50);

    const maxConfig = parseSourceLimitsConfig({ maxSourcesPerNotebook: 300 });
    expect(maxConfig.maxSourcesPerNotebook).toBe(300);

    const midConfig = parseSourceLimitsConfig({ maxSourcesPerNotebook: 150 });
    expect(midConfig.maxSourcesPerNotebook).toBe(150);
  });

  it("ADM-02: invalid source limits (49, 301, non-integer, non-numeric) fail startup validation", () => {
    expect(() => parseSourceLimitsConfig({ maxSourcesPerNotebook: 49 })).toThrow(/50|min/i);
    expect(() => parseSourceLimitsConfig({ maxSourcesPerNotebook: 301 })).toThrow(/300|max/i);
    expect(() => parseSourceLimitsConfig({ maxSourcesPerNotebook: 50.5 })).toThrow(/integer/i);
    expect(() => parseSourceLimitsConfig({ maxSourcesPerNotebook: "50" })).toThrow();
    expect(() => parseSourceLimitsConfig({ maxSourcesPerNotebook: -1 })).toThrow();
  });

  it("ADM-03: enforces 100 notebooks per user cap constant and schema validation", () => {
    expect(MAX_NOTEBOOKS_PER_USER).toBe(100);
    expect(() => parseSourceLimitsConfig({ maxNotebooksPerUser: 0 })).toThrow();
    expect(() => parseSourceLimitsConfig({ maxNotebooksPerUser: -5 })).toThrow();
  });

  it("ADM-04: SourceAdmissionAttempt requires UUID attempt_id, notebook_id, non-negative declared bytes", () => {
    const validAttempt = {
      attempt_id: "a0000000-0000-4000-8000-000000000001",
      notebook_id: "b0000000-0000-4000-8000-000000000001",
      declared_byte_size: 1024,
      file_name: "test.pdf",
      mime_type: "application/pdf",
    };
    const parsed = SourceAdmissionAttemptSchema.parse(validAttempt);
    expect(parsed.attempt_id).toBe(validAttempt.attempt_id);

    // Negative declared bytes rejected
    expect(() =>
      SourceAdmissionAttemptSchema.parse({
        ...validAttempt,
        declared_byte_size: -1,
      })
    ).toThrow();

    // Invalid attempt_id (not UUID) rejected
    expect(() =>
      SourceAdmissionAttemptSchema.parse({
        ...validAttempt,
        attempt_id: "not-a-uuid",
      })
    ).toThrow();
  });

  it("ADM-05: lowering configured limit below current usage blocks new admission without deleting content", () => {
    const config = parseSourceLimitsConfig({ maxSourcesPerNotebook: 50 });
    // When notebook has 50 sources, new admission is blocked
    expect(isAdmissionAllowedUnderConfig(50, config)).toBe(false);

    // When notebook has 60 sources (e.g. limit was lowered from 100 to 50), new admission is blocked
    expect(isAdmissionAllowedUnderConfig(60, config)).toBe(false);

    // When notebook has 49 sources, admission is allowed
    expect(isAdmissionAllowedUnderConfig(49, config)).toBe(true);
  });

  it("ADM-06: QuotaSummary schema validates authoritative bounds and fields", () => {
    const validSummary = {
      notebooks_used: 12,
      notebook_limit: 100,
      sources_used: 45,
      source_limit: 50,
      max_source_bytes: 200_000_000,
      max_source_words: 500_000,
    };
    const parsed = QuotaSummarySchema.parse(validSummary);
    expect(parsed.sources_used).toBe(45);

    expect(() =>
      QuotaSummarySchema.parse({
        ...validSummary,
        source_limit: 49,
      })
    ).toThrow();
  });
});
