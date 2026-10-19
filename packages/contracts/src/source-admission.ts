import { z } from "zod";
import { AppError } from "./errors.ts";

/**
 * Source Admission & Quota Contracts (FR-WM-07, FR-SI-01).
 * Enforces authoritative limits:
 * - 100 notebooks per user
 * - 50–300 sources per notebook (default 50)
 * - 200,000,000 bytes per source (inclusive)
 * - 500,000 extracted words per source (inclusive)
 */

export const MAX_NOTEBOOKS_PER_USER = 100;
export const DEFAULT_MAX_SOURCES_PER_NOTEBOOK = 50;
export const MIN_CONFIGURABLE_SOURCES_PER_NOTEBOOK = 50;
export const MAX_CONFIGURABLE_SOURCES_PER_NOTEBOOK = 300;
export const MAX_SOURCE_BYTES = 200_000_000; // 200 MB inclusive
export const MAX_SOURCE_WORDS = 500_000; // 500k words inclusive

export class SourceQuotaExceededError extends AppError {
  constructor(message: string = "Notebook has reached maximum sources limit") {
    super("SourceQuotaExceeded", 409, message);
    this.name = "SourceQuotaExceededError";
  }
}

export class SourceOversizedBytesError extends AppError {
  constructor(message: string = `Source exceeds ${MAX_SOURCE_BYTES.toLocaleString("en-US")} bytes limit`) {
    super("SourceOversized", 422, message);
    this.name = "SourceOversizedBytesError";
  }
}

export class SourceOversizedWordsError extends AppError {
  constructor(message: string = `Exceeds ${MAX_SOURCE_WORDS.toLocaleString("en-US")} words limit`) {
    super("SourceOversizedWords", 422, message);
    this.name = "SourceOversizedWordsError";
  }
}

export class DishonestDeclarationError extends AppError {
  constructor(message: string = "Actual byte size exceeds declared size and limit threshold") {
    super("DishonestDeclaration", 422, message);
    this.name = "DishonestDeclarationError";
  }
}

export const SourceAdmissionAttemptSchema = z.object({
  attempt_id: z.string().uuid("attempt_id must be a valid UUID"),
  notebook_id: z.string().uuid("notebook_id must be a valid UUID"),
  declared_byte_size: z.number().int().nonnegative("declared_byte_size must be a non-negative integer"),
  file_name: z.string().min(1, "file_name must not be empty"),
  mime_type: z.string().min(1, "mime_type must not be empty"),
});

export type SourceAdmissionAttempt = z.infer<typeof SourceAdmissionAttemptSchema>;

export const SourceLimitsConfigSchema = z.object({
  maxSourcesPerNotebook: z
    .number()
    .int("maxSourcesPerNotebook must be an integer")
    .min(MIN_CONFIGURABLE_SOURCES_PER_NOTEBOOK, `maxSourcesPerNotebook must be >= ${MIN_CONFIGURABLE_SOURCES_PER_NOTEBOOK}`)
    .max(MAX_CONFIGURABLE_SOURCES_PER_NOTEBOOK, `maxSourcesPerNotebook must be <= ${MAX_CONFIGURABLE_SOURCES_PER_NOTEBOOK}`)
    .default(DEFAULT_MAX_SOURCES_PER_NOTEBOOK),
  maxNotebooksPerUser: z.number().int().positive().default(MAX_NOTEBOOKS_PER_USER),
  maxBytesPerSource: z.number().int().positive().default(MAX_SOURCE_BYTES),
  maxWordsPerSource: z.number().int().positive().default(MAX_SOURCE_WORDS),
});

export type SourceLimitsConfig = z.infer<typeof SourceLimitsConfigSchema>;

export const QuotaSummarySchema = z.object({
  notebooks_used: z.number().int().nonnegative(),
  notebook_limit: z.number().int().positive().default(MAX_NOTEBOOKS_PER_USER),
  sources_used: z.number().int().nonnegative(),
  source_limit: z
    .number()
    .int()
    .min(MIN_CONFIGURABLE_SOURCES_PER_NOTEBOOK)
    .max(MAX_CONFIGURABLE_SOURCES_PER_NOTEBOOK)
    .default(DEFAULT_MAX_SOURCES_PER_NOTEBOOK),
  max_source_bytes: z.number().int().positive().default(MAX_SOURCE_BYTES),
  max_source_words: z.number().int().positive().default(MAX_SOURCE_WORDS),
});

export type QuotaSummary = z.infer<typeof QuotaSummarySchema>;

export function parseSourceLimitsConfig(rawConfig: unknown): SourceLimitsConfig {
  return SourceLimitsConfigSchema.parse(rawConfig ?? {});
}

export function isAdmissionAllowedUnderConfig(
  currentSources: number,
  config: SourceLimitsConfig
): boolean {
  return currentSources < config.maxSourcesPerNotebook;
}

export function validateDeclaredAdmission(
  attempt: { declared_byte_size?: number; file_name?: string },
  config?: SourceLimitsConfig
): void {
  const maxBytes = config?.maxBytesPerSource ?? MAX_SOURCE_BYTES;
  if (attempt.declared_byte_size !== undefined && attempt.declared_byte_size > maxBytes) {
    throw new SourceOversizedBytesError(`Source exceeds ${maxBytes} bytes limit`);
  }
}

export function validateWorkerReceivedSource(
  actualBytes: number,
  config?: SourceLimitsConfig
): void {
  const maxBytes = config?.maxBytesPerSource ?? MAX_SOURCE_BYTES;
  if (actualBytes > maxBytes) {
    throw new SourceOversizedBytesError(`Source exceeds ${maxBytes} bytes limit`);
  }
}

export function validateWorkerExtractedWords(
  wordCount: number,
  config?: SourceLimitsConfig
): void {
  if (typeof wordCount !== "number" || isNaN(wordCount) || wordCount < 0) {
    throw new Error("Invalid word count: word count must be a non-negative number");
  }
  const maxWords = config?.maxWordsPerSource ?? MAX_SOURCE_WORDS;
  if (wordCount > maxWords) {
    throw new SourceOversizedWordsError(`Exceeds ${maxWords.toLocaleString("en-US")} words limit`);
  }
}

export function detectDishonestDeclaration(
  declaredBytes: number,
  actualBytes: number,
  config?: SourceLimitsConfig
): void {
  const maxBytes = config?.maxBytesPerSource ?? MAX_SOURCE_BYTES;
  if (declaredBytes <= maxBytes && actualBytes > maxBytes) {
    throw new DishonestDeclarationError(
      `Dishonest size declaration: declared ${declaredBytes} bytes within limit but actual ${actualBytes} bytes exceeds limit`
    );
  }
}
