import { describe, it, expect } from "vitest";
import {
  MAX_SOURCE_BYTES,
  MAX_SOURCE_WORDS,
  validateDeclaredAdmission,
  validateWorkerReceivedSource,
  validateWorkerExtractedWords,
  SourceOversizedBytesError,
  SourceOversizedWordsError,
  DishonestDeclarationError,
  detectDishonestDeclaration,
} from "../src/source-admission.js";

describe("T034 [P] [US3] Trusted-Worker Boundary and Size Validation (FR-WM-07, FR-SI-01)", () => {
  it("BND-01: independent 199,999,999 / 200,000,000 / 200,000,001 bytes threshold", () => {
    // 199,999,999 bytes: strictly allowed
    expect(() => validateDeclaredAdmission({ declared_byte_size: 199_999_999 })).not.toThrow();
    expect(() => validateWorkerReceivedSource(199_999_999)).not.toThrow();

    // 200,000,000 bytes: inclusive boundary passes
    expect(() => validateDeclaredAdmission({ declared_byte_size: 200_000_000 })).not.toThrow();
    expect(() => validateWorkerReceivedSource(200_000_000)).not.toThrow();

    // 200,000,001 bytes: strictly rejected
    expect(() => validateDeclaredAdmission({ declared_byte_size: 200_000_001 })).toThrow(
      SourceOversizedBytesError
    );
    expect(() => validateWorkerReceivedSource(200_000_001)).toThrow(SourceOversizedBytesError);
  });

  it("BND-02: independent 499,999 / 500,000 / 500,001 words threshold", () => {
    // 499,999 words: strictly allowed
    expect(() => validateWorkerExtractedWords(499_999)).not.toThrow();

    // 500,000 words: inclusive boundary passes
    expect(() => validateWorkerExtractedWords(500_000)).not.toThrow();

    // 500,001 words: fails with exact error message "Exceeds 500,000 words limit"
    expect(() => validateWorkerExtractedWords(500_001)).toThrow("Exceeds 500,000 words limit");
    expect(() => validateWorkerExtractedWords(500_001)).toThrow(SourceOversizedWordsError);
  });

  it("BND-03: 215 MB PDF rejected pre-upload on declared bytes", () => {
    const bytes215MB = 215 * 1024 * 1024; // ~225,443,840 bytes > 200,000,000
    expect(() =>
      validateDeclaredAdmission({ declared_byte_size: bytes215MB, file_name: "oversized.pdf" })
    ).toThrow(SourceOversizedBytesError);
  });

  it("BND-04: 40 MB TXT with 520,000 extracted words passes byte check but fails with 'Exceeds 500,000 words limit'", () => {
    const bytes40MB = 40 * 1024 * 1024; // ~41,943,040 bytes < 200,000,000
    expect(() => validateDeclaredAdmission({ declared_byte_size: bytes40MB })).not.toThrow();
    expect(() => validateWorkerReceivedSource(bytes40MB)).not.toThrow();

    // Fails on extracted word count with exact message
    expect(() => validateWorkerExtractedWords(520_000)).toThrow("Exceeds 500,000 words limit");
  });

  it("BND-05: dishonest declaration detected when actual bytes exceed declared and limit", () => {
    const declaredBytes = 10 * 1024 * 1024; // declared 10 MB
    const actualBytes = 205 * 1024 * 1024; // actual 205 MB

    expect(() => detectDishonestDeclaration(declaredBytes, actualBytes)).toThrow(
      DishonestDeclarationError
    );
  });

  it("BND-06: client-provided word count is never trusted; worker validation required", () => {
    // Calling validation without worker verification throws or enforces worker source
    expect(() => validateWorkerExtractedWords(undefined as any)).toThrow();
    expect(() => validateWorkerExtractedWords(-1)).toThrow();
  });
});
